import { globSync, readFileSync } from "node:fs";

const block = /^(?:resource|data|variable|output|locals|terraform|provider|module|moved)\b/;
const errors = [];
for (const file of globSync("infra/**/*.tf", { exclude: ["**/.terraform/**"] })) {
  const lines = readFileSync(file, "utf8").split("\n");
  let heredoc;
  for (const [index, line] of lines.entries()) {
    if (heredoc !== undefined) {
      if (line.trim() === heredoc) heredoc = undefined;
      continue;
    }
    heredoc = /<<-?(\w+)\s*$/.exec(line)?.[1];
    if (!block.test(line)) continue;
    if (/\{\s*\S.+\}\s*$/.test(line)) {
      errors.push(`${file}:${index + 1}: expand the block onto separate lines`);
    }
    if (index > 0 && lines[index - 1] === "}") {
      errors.push(`${file}:${index + 1}: add a blank line between blocks`);
    }
  }
}
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
