import type { Request } from "express";
import { DEFAULT_PROJECT_SLUG } from "./constants";
import { findProjectById, findProjectBySlug, listProjects } from "../stores/projects";

export function normalizeProjectSlug(slug?: string) {
  if (!slug) return DEFAULT_PROJECT_SLUG;
  const normalized = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : DEFAULT_PROJECT_SLUG;
}

function fallbackProjectSlug() {
  const projects = listProjects();
  return projects[0]?.slug ?? DEFAULT_PROJECT_SLUG;
}

export function resolveProjectSlug(req: Request) {
  const headerSlug = req.header("x-project-slug");
  if (headerSlug) {
    const project = findProjectBySlug(normalizeProjectSlug(headerSlug));
    if (project) {
      return project.slug;
    }
  }

  const headerId = req.header("x-project-id");
  if (headerId) {
    const project = findProjectById(headerId as string);
    if (project) {
      return project.slug;
    }
  }

  const querySlug = typeof req.query.projectSlug === "string" ? req.query.projectSlug : undefined;
  if (querySlug) {
    const project = findProjectBySlug(normalizeProjectSlug(querySlug));
    if (project) {
      return project.slug;
    }
  }

  return fallbackProjectSlug();
}
