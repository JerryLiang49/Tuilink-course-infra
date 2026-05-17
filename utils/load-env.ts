import { env } from "process";
import { config } from "dotenv";
import { resolve } from "path";

// Centralized env loading keeps every CDK entrypoint on the same stage/account
// convention. NODE_ENV selects .env.staging or .env.prod.
export const loadEnv = () => {
  const stage = env.NODE_ENV ?? "staging";
  const envFile = `.env.${stage}`;
  console.info(`Parsing environment variables from ${envFile}\n`);

  // Load environment variables from .env file
  // resolve(process.cwd(), envFile) means commands must be run from course-infra.
  config({ path: resolve(process.cwd(), envFile) });

  // camelCasedStage is used in stack names, while account/region define the CDK
  // target environment for AWS deployments.
  return {
    stage,
    camelCasedStage: stage[0].toUpperCase() + stage.slice(1),
    account: env.AWS_ACCOUNT,
    region: env.AWS_REGION,
  };
};
