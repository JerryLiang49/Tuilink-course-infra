import { env } from "process";
import { config } from "dotenv";
import { resolve } from "path";

export const loadEnv = () => {
  const stage = env.NODE_ENV ?? "staging";
  const envFile = `.env.${stage}`;
  console.info(`Parsing environment variables from ${envFile}\n`);

  // Load environment variables from .env file
  config({ path: resolve(process.cwd(), envFile) });

  return {
    stage,
    camelCasedStage: stage[0].toUpperCase() + stage.slice(1),
    account: env.AWS_ACCOUNT,
    region: env.AWS_REGION,
  };
};
