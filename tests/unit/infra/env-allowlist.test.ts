import { expect, test } from "vitest";

import { filterEnv } from "../../../src/infra/env-allowlist";

test("TC-6.3a: provider env inherits only allowlisted keys plus overrides", () => {
	const filtered = filterEnv(
		{
			PATH: "/usr/bin",
			HOME: "/tmp/home",
			LANG: "en_US.UTF-8",
			GITHUB_TOKEN: "override-me",
			HTTPS_PROXY: "http://proxy.example:8080",
			NODE_OPTIONS: "--inspect",
			AWS_SECRET_ACCESS_KEY: "secret",
			CUSTOM_LEAK: "nope",
		},
		{
			GITHUB_TOKEN: "override-token",
			CUSTOM_PROVIDER_ENDPOINT: "http://127.0.0.1:9999",
			NODE_OPTIONS: "--require ./trusted-provider-hook.js",
		},
	);

	expect(filtered).toMatchObject({
		PATH: "/usr/bin",
		HOME: "/tmp/home",
		LANG: "en_US.UTF-8",
		GITHUB_TOKEN: "override-token",
		HTTPS_PROXY: "http://proxy.example:8080",
		CUSTOM_PROVIDER_ENDPOINT: "http://127.0.0.1:9999",
		NODE_OPTIONS: "--require ./trusted-provider-hook.js",
	});
	expect(filtered.AWS_SECRET_ACCESS_KEY).toBeUndefined();
	expect(filtered.CUSTOM_LEAK).toBeUndefined();
});

test("TC-6.3a: preserves Windows-required profile, shell, and temp variables", () => {
	const filtered = filterEnv({
		APPDATA: "C:\\Users\\Lee\\AppData\\Roaming",
		LOCALAPPDATA: "C:\\Users\\Lee\\AppData\\Local",
		USERPROFILE: "C:\\Users\\Lee",
		HOMEDRIVE: "C:",
		HOMEPATH: "\\Users\\Lee",
		COMSPEC: "C:\\Windows\\System32\\cmd.exe",
		PATHEXT: ".COM;.EXE;.BAT;.CMD",
		SYSTEMROOT: "C:\\Windows",
		WINDIR: "C:\\Windows",
		TEMP: "C:\\Temp",
		TMP: "C:\\Temp",
		NODE_OPTIONS: "--inspect",
	});

	expect(filtered).toMatchObject({
		APPDATA: "C:\\Users\\Lee\\AppData\\Roaming",
		LOCALAPPDATA: "C:\\Users\\Lee\\AppData\\Local",
		USERPROFILE: "C:\\Users\\Lee",
		HOMEDRIVE: "C:",
		HOMEPATH: "\\Users\\Lee",
		COMSPEC: "C:\\Windows\\System32\\cmd.exe",
		PATHEXT: ".COM;.EXE;.BAT;.CMD",
		SYSTEMROOT: "C:\\Windows",
		WINDIR: "C:\\Windows",
		TEMP: "C:\\Temp",
		TMP: "C:\\Temp",
	});
	expect(filtered.NODE_OPTIONS).toBeUndefined();
});

test("TC-6.3a: undefined overrides remove inherited allowlisted keys", () => {
	const filtered = filterEnv(
		{
			PATH: "/usr/bin",
			HTTP_PROXY: "http://proxy.example:8080",
			CODEX_TOKEN: "allowed-token",
		},
		{
			HTTP_PROXY: undefined,
			CODEX_TOKEN: "override-token",
		},
	);

	expect(filtered.PATH).toBe("/usr/bin");
	expect(filtered.HTTP_PROXY).toBeUndefined();
	expect(filtered.CODEX_TOKEN).toBe("override-token");
});

test("TC-6.3a: process.env-shaped overrides are treated as explicit caller intent", () => {
	const parent = {
		PATH: "/usr/bin",
		CODEX_TOKEN: "allowed-token",
		AWS_SECRET_ACCESS_KEY: "secret",
		NODE_OPTIONS: "--inspect",
		CUSTOM_LEAK: "nope",
	};

	const filtered = filterEnv(parent, parent);

	expect(filtered.PATH).toBe("/usr/bin");
	expect(filtered.CODEX_TOKEN).toBe("allowed-token");
	expect(filtered.AWS_SECRET_ACCESS_KEY).toBe("secret");
	expect(filtered.NODE_OPTIONS).toBe("--inspect");
	expect(filtered.CUSTOM_LEAK).toBe("nope");
});
