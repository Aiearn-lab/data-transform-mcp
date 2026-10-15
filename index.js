#!/usr/bin/env node
/**
 * data-transform-mcp — JSON <-> CSV 双向转换 MCP 工具
 * 知微工作室 · Zhiwei Studio · 2026-10-15 · v1.0.0
 *
 * 提供 2 个工具：
 *   json_to_csv  JSON 数组 → CSV（自动生成表头；嵌套对象/数组序列化为字符串）
 *   csv_to_json  CSV → JSON 数组（自动推断类型：数字 / 布尔 / null / 字符串）
 *
 * 设计原则：
 *   - 零第三方依赖（CSV 解析 / 生成全部原生实现，仅依赖 MCP SDK）
 *   - 完整支持 RFC 4180（引号转义、逗号、换行）
 *   - 完整支持中文 / Unicode
 *   - 不存储、不硬编码任何凭证
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/* ===== CSV 纯原生实现（RFC 4180 兼容） ===== */

/**
 * 把单个字段值转成 CSV 安全字符串
 * 规则：含分隔符 / 双引号 / 换行的字段用双引号包裹；内部双引号 doubled
 * @param {*} val       字段值
 * @param {string} sep  当前使用的分隔符（默认逗号）
 */
function csvEscape(val, sep = ",") {
  if (val === null || val === undefined) return "";
  const str = String(val);
  // 动态构建检测正则：分隔符 + 双引号 + 换行
  const needQuote = str.includes('"') || str.includes(sep) || /\r|\n/.test(str);
  if (needQuote) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * JSON 数组 → CSV 字符串
 * @param {Array} arr   JSON 数组
 * @param {string} sep  分隔符，默认逗号
 * @returns {string}    CSV 文本（含表头行）
 */
function jsonToCsv(arr, sep = ",") {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("输入必须是长度 >= 1 的 JSON 数组");
  }

  // 收集表头：按出现顺序去重
  const headers = [];
  const seen = new Set();
  for (const row of arr) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          headers.push(key);
        }
      }
    }
  }
  if (headers.length === 0) {
    throw new Error("数组元素必须是对象（plain object）");
  }

  // 逐行序列化（csvEscape 需要感知分隔符，以便 tab 等非逗号分隔符也能正确转义）
  const lines = [headers.map(h => csvEscape(h, sep)).join(sep)];
  for (const row of arr) {
    const vals = headers.map(h => {
      const v = row?.[h];
      // 嵌套对象 / 数组 → JSON 字符串；其余直接转字符串
      if (v !== null && v !== undefined && typeof v === "object") {
        return csvEscape(JSON.stringify(v), sep);
      }
      return csvEscape(v, sep);
    });
    lines.push(vals.join(sep));
  }

  return lines.join("\r\n");
}

/**
 * CSV 单字段反序列化：去掉 RFC 4180 引号包裹
 * @param {string} raw  原始字段文本
 * @returns {string}    去引号后的纯文本
 */
function unquoteField(raw) {
  let val = raw.trim();
  if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
    val = val.slice(1, -1).replace(/""/g, '"');
  }
  return val;
}

/**
 * 解析 CSV 文本为二维字符串数组
 * 支持：引号内逗号、引号内换行、doubled 引号转义
 * @param {string} text  CSV 文本
 * @param {string} sep  分隔符，默认逗号
 * @returns {string[][]} 二维数组（未做类型推断）
 */
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
        // doubled quote → 转义
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // 否则结束引号段
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    // 非引号内
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === sep) {
      cur.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === '\r') {
      // \r\n 或单独 \r 都视为行结束
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
      i++;
      if (i < text.length && text[i] === '\n') i++;
      continue;
    }
    if (ch === '\n') {
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // 处理末尾未结束的字段
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  // 过滤空行
  return rows.filter(r => r.length > 0 && !(r.length === 1 && r[0] === ""));
}

/**
 * 字符串值 → 自动推断类型
 * 优先级：空 → null，JSON 对象/数组 → 解析值，布尔 → boolean，
 *         数字（不含前导零）→ number，其余 → string
 */
function inferType(val) {
  if (val === "" || val === undefined) return null;
  if (val === "null") return null;

  // 尝试 JSON 解析（捕获数组 / 对象 / 数字 / 布尔）
  if (
    (val[0] === "[" && val[val.length - 1] === "]") ||
    (val[0] === "{" && val[val.length - 1] === "}")
  ) {
    try { return JSON.parse(val); } catch { /* 不是合法 JSON，当字符串 */ }
  }

  if (val === "true") return true;
  if (val === "false") return false;

  // 数字：允许负数、小数、科学计数法；拒绝前导零（如 "01"）保留为字符串
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(val)) {
    return Number(val);
  }

  return val;
}

/**
 * CSV 字符串 → JSON 数组
 * @param {string} csvText  CSV 文本（首行为表头）
 * @param {string} sep     分隔符，默认逗号
 * @returns {Array<object>} JSON 对象数组
 */
function csvToJson(csvText, sep = ",") {
  const rows = parseCsv(csvText, sep);
  if (rows.length < 2) {
    throw new Error("CSV 至少需要表头行 + 1 行数据");
  }

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

/* ===== MCP Server ===== */

const server = new Server(
  { name: "data-transform-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "json_to_csv",
      description: "把 JSON 数组转成 CSV 字符串。自动生成表头（按字段首次出现顺序）；嵌套对象和数组会被序列化为 JSON 字符串；支持自定义分隔符。",
      inputSchema: {
        type: "object",
        properties: {
          data: {
            type: "array",
            description: "JSON 对象数组，例如 [{\"name\":\"Alice\",\"age\":30}]",
            items: { type: "object" },
          },
          separator: {
            type: "string",
            description: "字段分隔符，默认 \",\"。可改为 \"\\t\" 生成 TSV",
          },
        },
        required: ["data"],
      },
    },
    {
      name: "csv_to_json",
      description: "把 CSV 文本转成 JSON 对象数组。首行视为表头；自动推断类型：数字 / 布尔 / null / JSON 数组/对象 / 字符串；支持自定义分隔符。",
      inputSchema: {
        type: "object",
        properties: {
          csv: {
            type: "string",
            description: "CSV 文本（首行为表头）",
          },
          separator: {
            type: "string",
            description: "字段分隔符，默认 \",\"",
          },
        },
        required: ["csv"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a } = req.params;
  try {
    if (name === "json_to_csv") {
      const sep = a.separator || ",";
      const csv = jsonToCsv(a.data, sep);
      return { content: [{ type: "text", text: csv }] };
    }

    if (name === "csv_to_json") {
      const sep = a.separator || ",";
      const result = csvToJson(a.csv, sep);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    return { content: [{ type: "text", text: "未知工具: " + name }], isError: true };
  } catch (e) {
    return {
      content: [{ type: "text", text: "错误: " + (e && e.message ? e.message : String(e)) }],
      isError: true,
    };
  }
});

// 启动 stdio 传输
const transport = new StdioServerTransport();
await server.connect(transport);
