/**
 * Copyright 2013-2024 the original author or authors from the JHipster project.
 *
 * This file is part of the JHipster project, see https://www.jhipster.tech/
 * for more information.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import chalk from 'chalk';

import BaseWorkspacesGenerator from '../base-workspaces/index.js';

import { checkImages, generateJwtSecret, configureImageNames, loadFromYoRc } from '../base-workspaces/internal/docker-base.js';
import {
  checkHelm,
  checkKubernetes,
  loadConfig,
  setupKubernetesConstants,
  setupHelmConstants,
  derivedKubernetesPlatformProperties,
} from '../kubernetes/kubernetes-base.js';
import { kubernetesPlatformTypes, buildToolTypes, messageBrokerTypes } from '../../jdl/jhipster/index.js';
import { getJdbcUrl } from '../spring-data-relational/support/index.js';
import { loadDeploymentConfig, loadDockerDependenciesTask } from '../base-workspaces/internal/index.js';
import { checkDocker } from '../docker/support/index.js';
import { loadDerivedServerConfig } from '../server/support/index.js';
import { loadDerivedAppConfig } from '../app/support/index.js';
import { writeFiles } from './files.js';
import prompts from './prompts.js';

const { GeneratorTypes } = kubernetesPlatformTypes;
const { MAVEN } = buildToolTypes;
const { KAFKA } = messageBrokerTypes;

const { K8S } = GeneratorTypes;

/**
 * @class
 * @extends {BaseWorkspacesGenerator}
 */
export default class KubernetesKnativeGenerator extends BaseWorkspacesGenerator {
  async beforeQueue() {
    if (!this.fromBlueprint) {
      await this.composeWithBlueprints();
    }
  }

  get initializing() {
    return this.asInitializingTaskGroup({
      sayHello() {
        this.log.log(chalk.white(`${chalk.bold('☸')} Welcome to the JHipster Kubernetes Knative Generator ${chalk.bold('☸')}`));
        this.log.log(chalk.white(`Files will be generated in the folder: ${chalk.yellow(this.destinationRoot())}`));
      },
      existingDeployment() {
        this.regenerate = this.regenerate || this.config.existed;
      },
      loadDockerDependenciesTask,
      checkDocker,
      checkKubernetes,
      checkHelm,
      async checkKnative() {
        if (this.skipChecks) return;
        try {
          await this.spawnCommand(
            'kubectl get deploy -n knative-serving --label-columns=serving.knative.dev/release | grep -E "v0\\.[8-9]{1,3}\\.[0-9]*',
          );
        } catch (error) {
          this.log.warn(
            'Knative 0.8.* or later is not installed on your computer.\n' +
              'Make sure you have Knative and Istio installed. Read https://knative.dev/docs/install/\n',
          );
        }
      },
      loadConfig,
      localInit() {
        this.deploymentApplicationType = 'microservice';
        this.istio = true;
      },
      setupKubernetesConstants,
      setupHelmConstants,
    });
  }

  get [BaseWorkspacesGenerator.INITIALIZING]() {
    return this.delegateTasksToBlueprint(() => this.initializing);
  }

  get prompting() {
    return {
      askForPath: prompts.askForPath,
      askForApps: prompts.askForApps,
      askForGeneratorType: prompts.askForGeneratorType,
      askForMonitoring: prompts.askForMonitoring,
      askForClustersMode: prompts.askForClustersMode,
      askForServiceDiscovery: prompts.askForServiceDiscovery,
      askForAdminPassword: prompts.askForAdminPassword,
      askForKubernetesNamespace: prompts.askForKubernetesNamespace,
      askForDockerRepositoryName: prompts.askForDockerRepositoryName,
      askForDockerPushCommand: prompts.askForDockerPushCommand,
      askForIngressDomain: prompts.askForIngressDomain,
    };
  }

  get [BaseWorkspacesGenerator.PROMPTING]() {
    return this.delegateTasksToBlueprint(() => this.prompting);
  }

  get configuring() {
    return {
      generateJwtSecret,
    };
  }

  get [BaseWorkspacesGenerator.CONFIGURING]() {
    return this.delegateTasksToBlueprint(() => this.configuring);
  }

  get loading() {
    return {
      loadFromYoRc,
      loadSharedConfig() {
        this.appConfigs.forEach(element => {
          loadDerivedAppConfig({ application: element });
          loadDerivedServerConfig({ application: element });
        });
        loadDeploymentConfig.call(this);
        derivedKubernetesPlatformProperties(this);
      },
    };
  }

  get [BaseWorkspacesGenerator.LOADING]() {
    return this.delegateTasksToBlueprint(() => this.loading);
  }

  get preparing() {
    return {
      configureImageNames,

      setPostPromptProp() {
        this.appConfigs.forEach(element => {
          element.clusteredDb ? (element.dbPeerCount = 3) : (element.dbPeerCount = 1);
          if (element.messageBroker === KAFKA) {
            this.useKafka = true;
          }
        });
        this.useKeycloak = false;
      },
    };
  }

  get [BaseWorkspacesGenerator.PREPARING]() {
    return this.delegateTasksToBlueprint(() => this.preparing);
  }

  get writing() {
    return writeFiles();
  }

  get [BaseWorkspacesGenerator.WRITING]() {
    return this.delegateTasksToBlueprint(() => this.writing);
  }

  get end() {
    return {
      checkImages,
      deploy() {
        if (this.hasWarning) {
          this.log.warn('Kubernetes Knative configuration generated, but no Jib cache found');
          this.log.warn('If you forgot to generate the Docker image for this application, please run:');
          this.log.warn(this.warningMessage);
        } else {
          this.log.verboseInfo(`\n${chalk.bold.green('Kubernetes Knative configuration successfully generated!')}`);
        }
        this.log.warn(
          '\nYou will need to push your image to a registry. If you have not done so, use the following commands to tag and push the images:',
        );
        for (let i = 0; i < this.appsFolders.length; i++) {
          const originalImageName = this.appConfigs[i].baseName.toLowerCase();
          const targetImageName = this.appConfigs[i].targetImageName;
          if (originalImageName !== targetImageName) {
            this.log.verboseInfo(`  ${chalk.cyan(`docker image tag ${originalImageName} ${targetImageName}`)}`);
          }
          this.log.verboseInfo(`  ${chalk.cyan(`${this.dockerPushCommand} ${targetImageName}`)}`);
        }
        if (this.dockerRepositoryName) {
          this.log.log('\nAlternatively, you can use Jib to build and push image directly to a remote registry:');
          this.appsFolders.forEach((appsFolder, index) => {
            const appConfig = this.appConfigs[index];
            let runCommand = '';
            if (appConfig.buildTool === MAVEN) {
              runCommand = `./mvnw -ntp -Pprod verify jib:build${
                process.arch === 'arm64' ? ' -Djib-maven-plugin.architecture=arm64' : ''
              } -Djib.to.image=${appConfig.targetImageName}`;
            } else {
              runCommand = `./gradlew bootJar -Pprod jibBuild${process.arch === 'arm64' ? ' -PjibArchitecture=arm64' : ''} -Djib.to.image=${
                appConfig.targetImageName
              }`;
            }
            this.log.log(`${chalk.cyan(`${runCommand}`)} in ${this.destinationPath(this.directoryPath + appsFolder)}`);
          });
        }
        this.log.log('\nYou can deploy all your apps by running the following script:');
        if (this.generatorType === K8S) {
          this.log.verboseInfo(`  ${chalk.cyan('bash kubectl-knative-apply.sh')}`);
          // Make the apply script executable
          try {
            fs.chmodSync('kubectl-knative-apply.sh', '755');
          } catch (err) {
            this.log.warn("Failed to make 'kubectl-knative-apply.sh' executable, you may need to run 'chmod +x kubectl-knative-apply.sh'");
          }
        } else {
          this.log.verboseInfo(`  ${chalk.cyan('bash helm-knative-apply.sh or ./helm-knative-apply.sh')}`);
          this.log.log('\nYou can upgrade (after any changes) all your apps by running the following script:');
          this.log.verboseInfo(`  ${chalk.cyan('bash helm-knative-upgrade.sh or ./helm-knative-upgrade.sh')}`);
          // Make the apply script executable
          try {
            fs.chmodSync('helm-knative-apply.sh', '755');
            fs.chmodSync('helm-knative-upgrade.sh', '755');
          } catch (err) {
            this.log.warn(
              "Failed to make 'helm-knative-apply.sh', 'helm-knative-upgrade.sh' executable, you may need to run 'chmod +x helm-knative-apply.sh helm-knative-upgrade.sh",
            );
          }
        }
      },
    };
  }

  get [BaseWorkspacesGenerator.END]() {
    return this.delegateTasksToBlueprint(() => this.end);
  }

  /**
   * @private
   * Returns the JDBC URL for a databaseType
   *
   * @param {string} databaseType
   * @param {*} options: databaseName, and required infos that depends of databaseType (hostname, localDirectory, ...)
   */
  getJDBCUrl(databaseType, options = {}) {
    return getJdbcUrl(databaseType, options);
  }
}
