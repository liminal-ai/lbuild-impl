import { expect, test } from "vitest";
import { epicFixProviderPayloadSchema } from "../../../src/core/epic-fix";
import { epicReverifyProviderPayloadSchema } from "../../../src/core/epic-reverifier";
import { epicVerifierProviderPayloadSchema } from "../../../src/core/epic-reviewer";
import {
	buildStrictCodexOutputSchema,
	isCodexStructuredOutputRootSchema,
} from "../../../src/core/provider-adapters/codex-output-schema";
import { storyImplementorProviderPayloadSchema } from "../../../src/core/story-implementor";
import { storyLeadActionSchema } from "../../../src/core/story-orchestrate-contracts";
import { storyVerifierProviderPayloadSchema } from "../../../src/core/story-verifier";

function assertStrictObjects(schema: unknown) {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return;
	}

	const record = schema as Record<string, unknown>;
	if (
		record.properties &&
		typeof record.properties === "object" &&
		!Array.isArray(record.properties)
	) {
		const properties = record.properties as Record<string, unknown>;
		const required = Array.isArray(record.required) ? record.required : [];

		expect(required.sort()).toEqual(Object.keys(properties).sort());

		for (const child of Object.values(properties)) {
			assertStrictObjects(child);
		}
	}

	if (record.items) {
		assertStrictObjects(record.items);
	}

	if (Array.isArray(record.anyOf)) {
		for (const child of record.anyOf) {
			assertStrictObjects(child);
		}
	}
}

test("story implementor fresh Codex output schema makes optional test counters required-and-nullable for OpenAI strict structured outputs", () => {
	const schema = buildStrictCodexOutputSchema(
		storyImplementorProviderPayloadSchema,
	) as {
		properties: {
			tests: {
				required: string[];
				properties: {
					totalAfterStory: {
						type?: string | string[];
						anyOf?: Array<Record<string, unknown>>;
					};
					deltaFromPriorBaseline: {
						type?: string | string[];
						anyOf?: Array<Record<string, unknown>>;
					};
				};
			};
		};
	};

	expect(schema.properties.tests.required).toEqual([
		"added",
		"modified",
		"removed",
		"totalAfterStory",
		"deltaFromPriorBaseline",
	]);
	expect(schema.properties.tests.properties.totalAfterStory.anyOf).toEqual([
		expect.objectContaining({
			type: "integer",
		}),
		expect.objectContaining({
			type: "null",
		}),
	]);
	expect(
		schema.properties.tests.properties.deltaFromPriorBaseline.anyOf,
	).toEqual([
		expect.objectContaining({
			type: "integer",
		}),
		expect.objectContaining({
			type: "null",
		}),
	]);
});

test("all fresh Codex provider payload schemas are OpenAI strict-mode compatible after normalization", () => {
	const schemas = [
		storyImplementorProviderPayloadSchema,
		storyVerifierProviderPayloadSchema,
		epicFixProviderPayloadSchema,
		epicVerifierProviderPayloadSchema,
		epicReverifyProviderPayloadSchema,
	];

	for (const schema of schemas) {
		const jsonSchema = buildStrictCodexOutputSchema(schema);
		assertStrictObjects(jsonSchema);
	}
});

test("story-lead action schema is a root union and must not be passed as a Codex structured output schema", () => {
	const schema = buildStrictCodexOutputSchema(storyLeadActionSchema);

	expect(schema).toHaveProperty("oneOf");
	expect(isCodexStructuredOutputRootSchema(schema)).toBe(false);
});
