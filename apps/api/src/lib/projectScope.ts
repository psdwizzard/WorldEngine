import type { Request } from "express";
import { DEFAULT_PROJECT_SLUG } from "./constants";
import { getHostedUser } from "../middleware/hostedAuth";
import { findProjectById, findProjectBySlug, listProjects } from "../stores/projects";

export function normalizeProjectSlug(slug?: string) {
  if (!slug) return DEFAULT_PROJECT_SLUG;
  const normalized = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : DEFAULT_PROJECT_SLUG;
}

export function resolveProjectSlug(req: Request) {
  const user = getHostedUser(req);
  const headerSlug = req.header("x-project-slug");
  if (headerSlug) {
    const project = findProjectBySlug(normalizeProjectSlug(headerSlug));
    if (project && project.userKey === user.userKey) {
      return project.slug;
    }
  }

  const headerId = req.header("x-project-id");
  if (headerId) {
    const project = findProjectById(headerId as string);
    if (project && project.userKey === user.userKey) {
      return project.slug;
    }
  }

  const querySlug = typeof req.query.projectSlug === "string" ? req.query.projectSlug : undefined;
  if (querySlug) {
    const project = findProjectBySlug(normalizeProjectSlug(querySlug));
    if (project && project.userKey === user.userKey) {
      return project.slug;
    }
  }

  return listProjects(user.userKey)[0]?.slug ?? `${user.userKey}-${DEFAULT_PROJECT_SLUG}`;
}
