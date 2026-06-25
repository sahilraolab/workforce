const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { FILE_SIZE_LIMITS, ALLOWED_DOC_MIMES, ALLOWED_PHOTO_MIMES } = require('../config/constants');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename(req, file, cb) {
    const randomBytes = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomBytes}${ext}`);
  },
});

function mimeFilter(allowed) {
  return (req, file, cb) => {
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
  };
}

const documentUpload = multer({
  storage,
  limits: { fileSize: FILE_SIZE_LIMITS.document, files: 10 },
  fileFilter: mimeFilter(ALLOWED_DOC_MIMES),
});

const photoUpload = multer({
  storage,
  limits: { fileSize: FILE_SIZE_LIMITS.photo, files: 1 },
  fileFilter: mimeFilter(ALLOWED_PHOTO_MIMES),
});

// Generic multi-field upload for the wizard (documents + photos in one form)
const workerUpload = multer({
  storage,
  limits: { fileSize: FILE_SIZE_LIMITS.document, files: 20 },
  fileFilter: mimeFilter(ALLOWED_DOC_MIMES),
});

// CSV bulk-import upload — kept in memory (not written to disk) since it's
// parsed once and discarded; never stored as a worker document.
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const okMime = ['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'].includes(file.mimetype);
    const okExt = file.originalname.toLowerCase().endsWith('.csv');
    if (okMime || okExt) cb(null, true);
    else cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  },
});

// Multer error handler middleware
function handleUploadError(err, req, res, next) {
  const t = res.locals.t;
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      req.flash('error', t('err_file_too_large'));
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      req.flash('error', t('err_invalid_file_type'));
    } else {
      req.flash('error', t('err_upload_generic', { message: err.message }));
    }
    return res.redirect('back');
  }
  next(err);
}

module.exports = { documentUpload, photoUpload, workerUpload, csvUpload, handleUploadError };
