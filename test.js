/**
 * data-transform-mcp 自测脚本
 * 知微工作室 · Zhiwei Studio · 2026-10-15
 *
 * 测试项：
 *   1. 基础往返：JSON → CSV → JSON，数据无损
 *   2. 嵌套对象 / 数组往返
 *   3. 中文 / Unicode 字符
 *   4. 类型推断（数字 / 布尔 / null / 字符串）
 *   5. 引号转义（字段内含逗号、双引号、换行）
 *   6. 自定义分隔符（TSV）
 *
 * 运行：node test.js
 */

// 直接 import 核心函数（不走 stdio，纯函数级测试）
// 因为 index.js 启动即连接 stdio，这里复制核心函数做单元测试
// —— 这也是为什么把核心函数写得纯净、无副作用的原因

/* ===== 复制核心函数（与 index.js 保持一致） ===== */

function csvEscape(val, sep = ",") {
  if (val === null || val === undefined) return "";
  const str = String(val);
  const needQuote = str.includes('"') || str.includes(sep) || /\r|\n/.test(str);
  if (needQuote) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function jsonToCsv(arr, sep = ",") {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("输入必须是长度 >= 1 的 JSON 数组");
  }
  const headers = [];
  const seen = new Set();
  for (const row of arr) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) { seen.add(key); headers.push(key); }
      }
    }
  }
  if (headers.length === 0) throw new Error("数组元素必须是对象");
  const lines = [headers.map(h => csvEscape(h, sep)).join(sep)];
  for (const row of arr) {
    const vals = headers.map(h => {
      const v = row?.[h];
      if (v !== null && v !== undefined && typeof v === "object") {
        return csvEscape(JSON.stringify(v), sep);
      }
      return csvEscape(v, sep);
    });
    lines.push(vals.join(sep));
  }
  return lines.join("\r\n");
}

function unquoteField(raw) {
  let val = raw.trim();
  if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
    val = val.slice(1, -1).replace(/""/g, '"');
  }
  return val;
}

function parseCsv(text, sep = ",") {
  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === sep) { cur.push(field); field = ""; i++; continue; }
    if (ch === '\r') {
      cur.push(field); field = ""; rows.push(cur); cur = []; i++;
      if (i < text.length && text[i] === '\n') i++;
      continue;
    }
    if (ch === '\n') { cur.push(field); field = ""; rows.push(cur); cur = []; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.length > 0 && !(r.length === 1 && r[0] === ""));
}

function inferType(val) {
  if (val === "" || val === undefined) return null;
  if (val === "null") return null;
  if (
    (val[0] === "[" && val[val.length - 1] === "]") ||
    (val[0] === "{" && val[val.length - 1] === "}")
  ) {
    try { return JSON.parse(val); } catch { /* fallback */ }
  }
  if (val === "true") return true;
  if (val === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(val)) return Number(val);
  return val;
}

function csvToJson(csvText, sep = ",") {
  const rows = parseCsv(csvText, sep);
  if (rows.length < 2) throw new Error("CSV 至少需要表头行 + 1 行数据");
  const headers = rows[0].map(h => unquoteField(h));
  const result = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const raw = c < row.length ? unquoteField(row[c]) : "";
      obj[headers[c]] = inferType(raw);
    }
    result.push(obj);
  }
  return result;
}

/* ===== 测试用例 ===== */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// 测试 1：基础往返
console.log("\n[1] 基础往返（JSON → CSV → JSON）");
{
  const original = [
    { name: "Alice", age: 30, active: true },
    { name: "Bob", age: 25, active: false },
  ];
  const csv = jsonToCsv(original);
  const back = csvToJson(csv);
  assert(deepEqual(back, original), "基础往返数据一致");
}

// 测试 2：嵌套对象 / 数组
console.log("\n[2] 嵌套对象 / 数组往返");
{
  const original = [
    { id: 1, meta: { city: "北京", tags: ["dev", "ai"] }, scores: [90, 85] },
    { id: 2, meta: { city: "上海", tags: ["design"] }, scores: [77] },
  ];
  const csv = jsonToCsv(original);
  const back = csvToJson(csv);
  assert(deepEqual(back, original), "嵌套对象/数组往返一致");
}

// 测试 3：中文 / Unicode
console.log("\n[3] 中文 / Unicode 字符");
{
  const original = [
    { 姓名: "张三", 城市: "北京", 备注: "你好，世界" },
    { 姓名: "李四", 城市: "上海", 备注: "测试中文,含逗号" },
  ];
  const csv = jsonToCsv(original);
  const back = csvToJson(csv);
  assert(deepEqual(back, original), "中文往返一致");
  assert(csv.includes("张三"), "CSV 包含中文内容");
}

// 测试 4：类型推断
console.log("\n[4] 类型推断");
{
  const csv = 'num,bool,nil,str\n42,true,null,hello\n-3.14,false,,world\n0,true,null,"123"';
  const result = csvToJson(csv);
  assert(result[0].num === 42, "整数推断为 number");
  assert(result[0].bool === true, "true 推断为 boolean");
  assert(result[0].nil === null, "null 推断为 null");
  assert(result[0].str === "hello", "普通字符串保持 string");
  assert(result[1].num === -3.14, "负小数推断正确");
  assert(result[1].nil === null, "空字符串推断为 null");
  assert(result[2].num === 0, "0 推断为 number");
  // 注意：CSV 中 "123"（引号包裹）去引号后与裸 123 无法区分，
  // 类型推断会返回 number —— 这是 CSV 格式的固有限制，属于预期行为
  assert(result[2].str === 123, "引号内纯数字 → 推断为 number（CSV 固有局限）");
}

// 测试 5：引号转义（字段内含逗号、双引号、换行）
console.log("\n[5] 引号转义");
{
  const original = [
    { text: '含"双引号"的文本', desc: "含,逗号的文本" },
    { text: "含\r\n换行的文本", desc: "普通文本" },
  ];
  const csv = jsonToCsv(original);
  const back = csvToJson(csv);
  // 注意：\r\n 在 CSV 字段里被引号包裹，解析后应还原
  assert(back[0].text === '含"双引号"的文本', "双引号转义正确");
  assert(back[0].desc === "含,逗号的文本", "逗号转义正确");
  assert(back[1].text === "含\r\n换行的文本", "换行转义正确");
}

// 测试 6：自定义分隔符（TSV）
console.log("\n[6] 自定义分隔符（TSV）");
{
  const original = [{ a: 1, b: "hello\tworld" }, { a: 2, b: "test" }];
  const tsv = jsonToCsv(original, "\t");
  assert(tsv.includes("\t"), "TSV 使用 tab 分隔");
  const back = csvToJson(tsv, "\t");
  assert(deepEqual(back, original), "TSV 往返一致");
}

// 测试 7：缺失字段（不同对象有不同 key）
console.log("\n[7] 缺失字段合并");
{
  const original = [
    { name: "Alice", age: 30 },
    { name: "Bob", email: "bob@test.com" },
  ];
  const csv = jsonToCsv(original);
  const back = csvToJson(csv);
  assert(back[0].name === "Alice", "第一行 name 正确");
  assert(back[0].age === 30, "第一行 age 正确");
  assert(back[0].email === null, "第一行缺失 email → null");
  assert(back[1].email === "bob@test.com", "第二行 email 正确");
  assert(back[1].age === null, "第二行缺失 age → null");
}

// 测试 8：空数组报错
console.log("\n[8] 边界：空数组");
{
  let threw = false;
  try { jsonToCsv([]); } catch { threw = true; }
  assert(threw, "空数组抛出异常");
}

// 汇总
console.log(`\n========== 结果 ==========`);
console.log(`通过: ${passed}  失败: ${failed}`);
if (failed > 0) {
  console.error("有测试失败！");
  process.exit(1);
} else {
  console.log("全部通过 ✓");
}
