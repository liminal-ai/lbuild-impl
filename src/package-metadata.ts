import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import packageJson from "../package.json" with { type: "json" };

export const packageName = packageJson.name;
export const packageVersion = packageJson.version;
export const packageRootPath = dirname(
	fileURLToPath(new URL("../package.json", import.meta.url)),
);
