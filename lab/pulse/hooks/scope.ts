/**
 * What a picture covers: everything recent, one project and everything
 * under it, or one repository's sessions.
 */

import { drawn } from "./plain";

export type Scope =
  | { kind: "all" }
  /** `ref` is the project's id, or its name as typed; `label` is drawn until the project itself is known. */
  | { kind: "project"; ref: string; label: string }
  | { kind: "repo"; repo: string };

const MAX_ARGUMENT = 200;
const REFERENCE =
  /^\{\{fylgja:project(?: [^{}|\n]{0,200})?\|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}\}$/;

/** `org/repo` with nothing else, or a path: what a project's name does not look like. */
const REPO = /^(?:[\w.-]+\/[\w.-]+|~?\/.*|\.{1,2}\/.*)$/;

/**
 * The scope the words after `/pulse` name: nothing is everything recent, a
 * path or `org/repo` is a repository, a pasted project reference is that
 * project, and anything else is a project's name.
 */
export function scopeOf(args: string): Scope {
  const typed = args.trim().slice(0, MAX_ARGUMENT);

  if (typed === "") {
    return { kind: "all" };
  }

  const pasted = REFERENCE.exec(typed)?.[1];

  if (pasted !== undefined) {
    return { kind: "project", ref: pasted.toLowerCase(), label: "project" };
  }

  if (REPO.test(typed)) {
    return { kind: "repo", repo: typed };
  }

  return { kind: "project", ref: typed, label: drawn(typed, 60) };
}

/** One key per scope, for what is held about it. */
export function scopeKey(scope: Scope): string {
  if (scope.kind === "all") {
    return "all";
  }

  return scope.kind === "repo"
    ? `repo:${scope.repo}`
    : `project:${scope.ref.toLowerCase()}`;
}
