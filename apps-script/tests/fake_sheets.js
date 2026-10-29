/**
 * SpreadsheetApp ปลอมแบบเก็บข้อมูลในหน่วยความจำ สำหรับเทสต์ชั้นที่คุยกับชีต
 *
 * ทำเท่าที่โค้ดจริงเรียกใช้เท่านั้น ไม่ได้เลียนแบบ Sheets ทั้งหมด
 * ถ้าโค้ดจริงเริ่มเรียก API ตัวใหม่ เทสต์จะพังทันทีให้เห็น ซึ่งเป็นสิ่งที่ต้องการ
 */

function cell(v) {
  return v === undefined || v === null ? '' : v;
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        line.push(cell(this.sheet.read(this.row + r, this.col + c)));
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.numRows) {
      throw new Error('setValues: จำนวนแถวไม่ตรงกับ range (' + values.length + ' vs ' + this.numRows + ')');
    }
    values.forEach((line, r) => {
      if (line.length !== this.numCols) {
        throw new Error('setValues: จำนวนคอลัมน์ไม่ตรงกับ range');
      }
      line.forEach((v, c) => this.sheet.write(this.row + r, this.col + c, v));
    });
    return this;
  }
  setValue(v) {
    this.sheet.write(this.row, this.col, v);
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) this.sheet.write(this.row + r, this.col + c, '');
    }
    return this;
  }
  // ตัวจัดรูปแบบ: ไม่ได้เก็บผล แค่ให้เรียกได้โดยไม่พัง
  setNote() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setVerticalAlignment() { return this; }
  setFontColor() { return this; }
  setFontStyle() { return this; }
  setNumberFormat() { return this; }
  setWrap() { return this; }
  setDataValidation() { return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = []; // array ของ array เริ่มที่แถว 1 = index 0
    this.writes = []; // เลขแถวที่ถูกเขียน ใช้พิสูจน์ว่าโค้ดแตะเฉพาะแถวที่ควรแตะ
    this.reads = 0;   // จำนวนครั้งที่อ่านทั้งชีต
  }
  getName() { return this.name; }
  read(row, col) {
    const line = this.rows[row - 1];
    return line ? cell(line[col - 1]) : '';
  }
  write(row, col, value) {
    this.writes.push(row);
    while (this.rows.length < row) this.rows.push([]);
    const line = this.rows[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = cell(value);
  }
  getLastRow() {
    for (let r = this.rows.length; r >= 1; r--) {
      const line = this.rows[r - 1] || [];
      if (line.some((v) => cell(v) !== '')) return r;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((line) => {
      for (let c = line.length; c >= 1; c--) {
        if (cell(line[c - 1]) !== '') { max = Math.max(max, c); break; }
      }
    });
    return max;
  }
  getRange(row, col, numRows, numCols) {
    return new FakeRange(this, row, col, numRows === undefined ? 1 : numRows,
                         numCols === undefined ? 1 : numCols);
  }
  getDataRange() {
    this.reads++; // นับจำนวนครั้งที่อ่านทั้งชีต ใช้ดูว่า cache ทำงานจริงไหม
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  deleteRows(start, count) {
    if (start < 1 || count < 1) throw new Error('deleteRows: พารามิเตอร์ไม่ถูกต้อง');
    this.rows.splice(start - 1, count);
  }
  deleteRow(row) { this.deleteRows(row, 1); }
  appendRow(values) {
    const row = this.getLastRow() + 1;
    values.forEach((v, c) => this.write(row, c + 1, v));
    return this;
  }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  setConditionalFormatRules() { return this; }
  activate() { return this; }
  setActiveRange() { return this; }
  getActiveRange() { return null; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getId() { return 'fake-spreadsheet-id'; }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) {
    this.sheets[name] = new FakeSheet(name);
    return this.sheets[name];
  }
  getActiveSheet() { return Object.values(this.sheets)[0] || null; }
}

/** ใส่ข้อมูลลงชีตจากตาราง 2 มิติ (แถวแรกคือหัวตาราง) */
function seedSheet(ss, name, rows) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  rows.forEach((line, r) => line.forEach((v, c) => sh.write(r + 1, c + 1, v)));
  return sh;
}

/** อ่านชีตกลับมาเป็นตาราง 2 มิติ ไว้เทียบผลในเทสต์ */
function dumpSheet(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (!last) return [];
  return sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
}

module.exports = { FakeSpreadsheet, FakeSheet, seedSheet, dumpSheet };
