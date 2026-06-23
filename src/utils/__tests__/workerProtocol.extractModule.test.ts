// @vitest-environment node
//
// Unit test for the `extractModule` worker command payload + validator (R2
// locality-based module extraction). Proves the strict protocol contract:
// signature must be a non-empty string[], moduleType (when present) is the
// enum 'bot'|'star', and includeOntologies (when present) is a boolean.
import { describe, it, expect } from "vitest";
import {
  validateRdfWorkerCommandInput,
  RDF_WORKER_COMMANDS,
} from "../rdfManager.workerProtocol";

describe("extractModule worker command", () => {
  it("is a registered command", () => {
    expect(RDF_WORKER_COMMANDS).toContain("extractModule");
  });

  it("accepts a minimal valid payload (non-empty signature)", () => {
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", {
        signature: ["http://example.org/A"],
      }),
    ).not.toThrow();
  });

  it("accepts moduleType 'bot' and 'star'", () => {
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", {
        signature: ["http://example.org/A"],
        moduleType: "bot",
      }),
    ).not.toThrow();
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", {
        signature: ["http://example.org/A"],
        moduleType: "star",
      }),
    ).not.toThrow();
  });

  it("accepts a boolean includeOntologies", () => {
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", {
        signature: ["http://example.org/A"],
        includeOntologies: false,
      }),
    ).not.toThrow();
  });

  it("rejects a missing or non-object payload", () => {
    expect(() => validateRdfWorkerCommandInput("extractModule", undefined)).toThrow();
    expect(() => validateRdfWorkerCommandInput("extractModule", "x")).toThrow();
  });

  it("rejects an empty signature array", () => {
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", { signature: [] }),
    ).toThrow();
  });

  it("rejects a non-array signature", () => {
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", { signature: "http://example.org/A" }),
    ).toThrow();
  });

  it("rejects non-string / empty-string signature entries", () => {
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", { signature: [42] }),
    ).toThrow();
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", { signature: ["   "] }),
    ).toThrow();
  });

  it("rejects an invalid moduleType enum value", () => {
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", {
        signature: ["http://example.org/A"],
        moduleType: "top",
      }),
    ).toThrow();
  });

  it("rejects a non-boolean includeOntologies", () => {
    expect(() =>
      validateRdfWorkerCommandInput("extractModule", {
        signature: ["http://example.org/A"],
        includeOntologies: "yes",
      }),
    ).toThrow();
  });
});
