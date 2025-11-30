import multer from "multer";

// Allow high-res uploads for print workflows. Override via MAX_UPLOAD_MB if needed.
const DEFAULT_MAX_UPLOAD_MB = 150;
const parsedLimit = Number(process.env.MAX_UPLOAD_MB);
const maxUploadMb = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_MAX_UPLOAD_MB;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadMb * 1024 * 1024,
  },
});
