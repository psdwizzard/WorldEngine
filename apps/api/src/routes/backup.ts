/**
 * Backup and Restore API routes
 * 
 * Allows exporting all project data (characters, locations, items, panels, assets, outputs)
 * as a single ZIP file, and importing from a previously exported backup.
 */

import { Router } from "express";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, access, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import * as unzip from "unzip-stream";
import multer from "multer";

const repoRoot = path.resolve(process.cwd(), "..", "..");

/**
 * Get the workspace-data directory path
 */
function getDataRoot(): string {
  return process.env.DATA_ROOT || path.join(repoRoot, "workspace-data");
}

/**
 * Get the output directory path
 */
function getOutputRoot(): string {
  return path.join(repoRoot, "output");
}

/**
 * Check if a path exists
 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export const backupRouter = Router();

/**
 * GET /backup/export
 * 
 * Exports all project data as a ZIP file download.
 * Includes:
 * - workspace-data/projects.json
 * - workspace-data/projects/ (all project data, characters, locations, assets)
 * - output/ (generated PNGs and PSDs)
 */
backupRouter.get("/export", async (_req, res) => {
  try {
    const dataRoot = getDataRoot();
    const outputRoot = getOutputRoot();

    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `worldengine-backup-${timestamp}.zip`;

    // Set headers for file download
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Create archive
    const archive = archiver("zip", {
      zlib: { level: 6 }, // Balanced compression
    });

    // Pipe archive to response
    archive.pipe(res);

    // Handle archive errors
    archive.on("error", (err) => {
      console.error("backup:archive_error", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to create backup archive" });
      }
    });

    // Add projects.json if it exists
    const projectsJsonPath = path.join(dataRoot, "projects.json");
    if (await pathExists(projectsJsonPath)) {
      archive.file(projectsJsonPath, { name: "workspace-data/projects.json" });
    }

    // Add the entire projects directory
    const projectsDir = path.join(dataRoot, "projects");
    if (await pathExists(projectsDir)) {
      archive.directory(projectsDir, "workspace-data/projects");
    }

    // Add the output directory (generated images)
    if (await pathExists(outputRoot)) {
      archive.directory(outputRoot, "output");
    }

    // Add a manifest file with backup metadata
    const manifest = {
      version: "1.0",
      createdAt: new Date().toISOString(),
      application: "WorldEngine",
      contents: {
        workspaceData: await pathExists(dataRoot),
        output: await pathExists(outputRoot),
      },
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: "backup-manifest.json" });

    // Finalize the archive
    await archive.finalize();

    console.log(`backup:exported ${filename}`);
  } catch (error) {
    console.error("backup:export_failed", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to export backup" });
    }
  }
});

// Configure multer for backup file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max backup size
  },
});

/**
 * POST /backup/import
 * 
 * Imports project data from a previously exported ZIP backup.
 * Accepts multipart/form-data with a 'backup' file field.
 * WARNING: This will overwrite existing data!
 */
backupRouter.post("/import", upload.single("backup"), async (req, res) => {
  try {
    const dataRoot = getDataRoot();
    const outputRoot = getOutputRoot();

    // Check if we have a file upload
    if (!req.file) {
      return res.status(400).json({ error: "No backup file provided. Upload a ZIP file as 'backup' field." });
    }

    // Create a temporary extraction directory
    const tempDir = path.join(dataRoot, ".backup-restore-temp");
    await mkdir(tempDir, { recursive: true });

    // Write the uploaded file to temp location
    const tempZipPath = path.join(tempDir, "backup.zip");
    await writeFile(tempZipPath, req.file.buffer);

    try {
      // Extract the ZIP file
      await new Promise<void>((resolve, reject) => {
        const readStream = createReadStream(tempZipPath);
        const extract = unzip.Extract({ path: tempDir });
        
        readStream
          .pipe(extract)
          .on("close", resolve)
          .on("error", reject);
      });

      // Check for manifest to validate backup
      const manifestPath = path.join(tempDir, "backup-manifest.json");
      if (!(await pathExists(manifestPath))) {
        throw new Error("Invalid backup: missing manifest file");
      }

      // Restore workspace-data
      const extractedWorkspaceData = path.join(tempDir, "workspace-data");
      if (await pathExists(extractedWorkspaceData)) {
        // Copy projects.json
        const srcProjectsJson = path.join(extractedWorkspaceData, "projects.json");
        if (await pathExists(srcProjectsJson)) {
          await copyFile(srcProjectsJson, path.join(dataRoot, "projects.json"));
        }

        // Copy projects directory
        const srcProjectsDir = path.join(extractedWorkspaceData, "projects");
        if (await pathExists(srcProjectsDir)) {
          const destProjectsDir = path.join(dataRoot, "projects");
          await mkdir(destProjectsDir, { recursive: true });
          await copyDirectoryRecursive(srcProjectsDir, destProjectsDir);
        }
      }

      // Restore output directory
      const extractedOutput = path.join(tempDir, "output");
      if (await pathExists(extractedOutput)) {
        await mkdir(outputRoot, { recursive: true });
        await copyDirectoryRecursive(extractedOutput, outputRoot);
      }

      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true });

      res.json({ 
        success: true, 
        message: "Backup restored successfully. Please restart the server to reload data." 
      });

      console.log("backup:imported successfully from upload");
    } catch (extractError) {
      // Clean up on failure
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw extractError;
    }
  } catch (error) {
    console.error("backup:import_failed", error);
    res.status(500).json({ error: `Failed to import backup: ${(error as Error).message}` });
  }
});

/**
 * POST /backup/import-file
 * 
 * Imports from a backup file that's already on the local filesystem.
 * Body: { path: "/path/to/backup.zip" }
 */
backupRouter.post("/import-file", async (req, res) => {
  try {
    const { filePath } = req.body as { filePath?: string };
    
    if (!filePath) {
      return res.status(400).json({ error: "No file path provided" });
    }

    const dataRoot = getDataRoot();
    const outputRoot = getOutputRoot();

    // Verify the file exists
    if (!(await pathExists(filePath))) {
      return res.status(404).json({ error: "Backup file not found" });
    }

    // Create a temporary extraction directory
    const tempDir = path.join(dataRoot, ".backup-restore-temp");
    await mkdir(tempDir, { recursive: true });

    try {
      // Extract the ZIP file
      await new Promise<void>((resolve, reject) => {
        const readStream = createReadStream(filePath);
        const extract = unzip.Extract({ path: tempDir });
        
        readStream
          .pipe(extract)
          .on("close", resolve)
          .on("error", reject);
      });

      // Check for manifest to validate backup
      const manifestPath = path.join(tempDir, "backup-manifest.json");
      if (!(await pathExists(manifestPath))) {
        throw new Error("Invalid backup: missing manifest file");
      }

      // Restore workspace-data
      const extractedWorkspaceData = path.join(tempDir, "workspace-data");
      if (await pathExists(extractedWorkspaceData)) {
        // Copy projects.json
        const srcProjectsJson = path.join(extractedWorkspaceData, "projects.json");
        if (await pathExists(srcProjectsJson)) {
          await copyFile(srcProjectsJson, path.join(dataRoot, "projects.json"));
        }

        // Copy projects directory
        const srcProjectsDir = path.join(extractedWorkspaceData, "projects");
        if (await pathExists(srcProjectsDir)) {
          const destProjectsDir = path.join(dataRoot, "projects");
          await mkdir(destProjectsDir, { recursive: true });
          await copyDirectoryRecursive(srcProjectsDir, destProjectsDir);
        }
      }

      // Restore output directory
      const extractedOutput = path.join(tempDir, "output");
      if (await pathExists(extractedOutput)) {
        await mkdir(outputRoot, { recursive: true });
        await copyDirectoryRecursive(extractedOutput, outputRoot);
      }

      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true });

      res.json({ 
        success: true, 
        message: "Backup restored successfully. Please restart the server to reload data." 
      });

      console.log("backup:imported successfully");
    } catch (extractError) {
      // Clean up on failure
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw extractError;
    }
  } catch (error) {
    console.error("backup:import_file_failed", error);
    res.status(500).json({ error: `Failed to import backup: ${(error as Error).message}` });
  }
});

/**
 * Recursively copy a directory
 */
async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  
  const entries = await readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * GET /backup/info
 * 
 * Returns information about what would be backed up
 */
backupRouter.get("/info", async (_req, res) => {
  try {
    const dataRoot = getDataRoot();
    const outputRoot = getOutputRoot();

    const info = {
      dataRoot,
      outputRoot,
      workspaceDataExists: await pathExists(dataRoot),
      outputExists: await pathExists(outputRoot),
      projectsJsonExists: await pathExists(path.join(dataRoot, "projects.json")),
      projectsDirExists: await pathExists(path.join(dataRoot, "projects")),
    };

    res.json(info);
  } catch (error) {
    console.error("backup:info_failed", error);
    res.status(500).json({ error: "Failed to get backup info" });
  }
});
