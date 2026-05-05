import { runCli } from "./cli.js";

runCli(process.argv.slice(2))
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
