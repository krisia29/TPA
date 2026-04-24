// ============================================================
//  Tech Pathways Academy — Google Apps Script Backend
//  Paste this ENTIRE file into your Apps Script editor.
//  Deploy as Web App → Execute as: Me → Who has access: Anyone
// ============================================================

const SHEET_NAME = 'TPA_Users';
const UPLOAD_FOLDER_NAME = 'TPA_Uploads';

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'key','name','email','pass','role','joined',
      'acts','uploadMeta','lastUpdated'
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateFolder() {
  var folders = DriveApp.getFoldersByName(UPLOAD_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(UPLOAD_FOLDER_NAME);
}

function findRow(sheet, key) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return i + 1; // 1-indexed
  }
  return -1;
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var result;

    if (action === 'signup')        result = handleSignup(body);
    else if (action === 'login')    result = handleLogin(body);
    else if (action === 'getUser')  result = handleGetUser(body);
    else if (action === 'saveActs') result = handleSaveActs(body);
    else if (action === 'upload')   result = handleUpload(body);
    else if (action === 'removeUpload') result = handleRemoveUpload(body);
    else if (action === 'getAllStudents') result = handleGetAllStudents(body);
    else result = {ok:false, err:'Unknown action'};

    return respond(result);
  } catch(err) {
    return respond({ok:false, err:err.toString()});
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SIGNUP ──────────────────────────────
function handleSignup(body) {
  var sheet = getOrCreateSheet();
  var data = sheet.getDataRange().getValues();
  // Check email uniqueness
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] === body.email) return {ok:false, err:'email_taken'};
  }
  var key = body.name.trim() + '|||' + body.email.trim().toLowerCase();
  var now = new Date().toLocaleDateString();
  sheet.appendRow([
    key, body.name, body.email, body.pass, body.role,
    now, '{}', '{}', now
  ]);
  return {ok:true, user:{key,name:body.name,email:body.email,role:body.role,acts:{},uploadMeta:{},joined:now}};
}

// ── LOGIN ────────────────────────────────
function handleLogin(body) {
  var sheet = getOrCreateSheet();
  var data = sheet.getDataRange().getValues();
  var nameL = body.name.trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    var rowName = String(data[i][1]).trim().toLowerCase();
    var rowPass = String(data[i][3]);
    var rowRole = String(data[i][4]);
    if (rowName === nameL && rowPass === body.pass) {
      if (rowRole !== body.role) return {ok:false, err:'wrong_role'};
      return {ok:true, user:rowToUser(data[i])};
    }
  }
  return {ok:false, err:'not_found'};
}

// ── GET USER ────────────────────────────
function handleGetUser(body) {
  var sheet = getOrCreateSheet();
  var rowNum = findRow(sheet, body.key);
  if (rowNum < 0) return {ok:false, err:'not_found'};
  var row = sheet.getRange(rowNum, 1, 1, 9).getValues()[0];
  return {ok:true, user:rowToUser(row)};
}

// ── SAVE ACTS ───────────────────────────
function handleSaveActs(body) {
  var sheet = getOrCreateSheet();
  var rowNum = findRow(sheet, body.key);
  if (rowNum < 0) return {ok:false, err:'not_found'};
  sheet.getRange(rowNum, 7).setValue(JSON.stringify(body.acts));
  sheet.getRange(rowNum, 9).setValue(new Date().toLocaleDateString());
  return {ok:true};
}

// ── UPLOAD FILE ─────────────────────────
function handleUpload(body) {
  var folder = getOrCreateFolder();
  var sheet = getOrCreateSheet();
  var rowNum = findRow(sheet, body.key);
  if (rowNum < 0) return {ok:false, err:'not_found'};

  // Decode base64 and save to Drive
  var base64 = body.data.split(',')[1] || body.data;
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, body.mimeType, body.fileName);
  var subFolder = folder.getFoldersByName(body.key.replace(/[^a-z0-9]/gi,'_'));
  var dest = subFolder.hasNext() ? subFolder.next() : folder.createFolder(body.key.replace(/[^a-z0-9]/gi,'_'));
  var file = dest.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var fileId = file.getId();
  var viewUrl = 'https://drive.google.com/uc?id=' + fileId;
  var thumbUrl = body.mimeType.startsWith('image/') ? viewUrl : null;

  // Update uploadMeta in sheet
  var metaStr = sheet.getRange(rowNum, 8).getValue() || '{}';
  var meta = {};
  try { meta = JSON.parse(metaStr); } catch(e) {}
  if (!meta[body.actKey]) meta[body.actKey] = [];
  meta[body.actKey].push({name:body.fileName, mimeType:body.mimeType, fileId, viewUrl, thumbUrl, date:new Date().toLocaleDateString()});
  sheet.getRange(rowNum, 8).setValue(JSON.stringify(meta));

  // Auto-mark act done
  var actsStr = sheet.getRange(rowNum, 7).getValue() || '{}';
  var acts = {};
  try { acts = JSON.parse(actsStr); } catch(e) {}
  acts[body.actKey] = true;
  sheet.getRange(rowNum, 7).setValue(JSON.stringify(acts));
  sheet.getRange(rowNum, 9).setValue(new Date().toLocaleDateString());

  return {ok:true, file:{name:body.fileName,mimeType:body.mimeType,fileId,viewUrl,thumbUrl}};
}

// ── REMOVE UPLOAD ───────────────────────
function handleRemoveUpload(body) {
  var sheet = getOrCreateSheet();
  var rowNum = findRow(sheet, body.key);
  if (rowNum < 0) return {ok:false, err:'not_found'};
  var metaStr = sheet.getRange(rowNum, 8).getValue() || '{}';
  var meta = {};
  try { meta = JSON.parse(metaStr); } catch(e) {}
  if (meta[body.actKey] && meta[body.actKey][body.idx] !== undefined) {
    var removed = meta[body.actKey].splice(body.idx, 1)[0];
    try { DriveApp.getFileById(removed.fileId).setTrashed(true); } catch(e) {}
    sheet.getRange(rowNum, 8).setValue(JSON.stringify(meta));
  }
  return {ok:true};
}

// ── GET ALL STUDENTS (manager) ──────────
function handleGetAllStudents(body) {
  var sheet = getOrCreateSheet();
  var data = sheet.getDataRange().getValues();
  var students = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][4] === 'student') students.push(rowToUser(data[i]));
  }
  return {ok:true, students};
}

// ── ROW → USER OBJECT ───────────────────
function rowToUser(row) {
  var acts = {}, meta = {};
  try { acts = JSON.parse(row[6] || '{}'); } catch(e) {}
  try { meta = JSON.parse(row[7] || '{}'); } catch(e) {}
  return {
    key: row[0], name: row[1], email: row[2],
    role: row[4], joined: row[5],
    acts: acts, uploadMeta: meta
  };
}
