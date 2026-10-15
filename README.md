> **知微工作室 / Zhiwei Studio** — AI 工程外包：代码审查、数据清洗、论文复现、自动化脚本。官网与在线下单：https://ai-eng-capability.app.workbuddy.host/ ｜ 合作邮箱：cqsj6667@agent.qq.com

# data-transform-mcp · JSON <-> CSV 双向转换工具

> 知微工作室 · Zhiwei Studio｜2026-10-15｜v1.0.0｜Node 18+，MIT

一个轻量 MCP server，让你的 AI agent 能直接在对话里做 **JSON ↔ CSV 格式转换**。零第三方依赖（仅 MCP SDK），完整支持中文 / Unicode，自动处理嵌套对象和类型推断。

## 安装

```bash
cd data-transform-mcp
npm install
```

验证安装：

```bash
node --check index.js
```

运行自测：

```bash
node test.js
```

## 接入（MCP 客户端配置）

在你的 MCP 客户端配置文件里添加（例：Claude Desktop `claude_desktop_config.json`，或其他支持 MCP 的客户端）：

```json
{
  "mcpServers": {
    "data-transform": {
      "command": "node",
      "args": ["/你的绝对路径/data-transform-mcp/index.js"]
    }
  }
}
```

> Windows 用户注意：路径用反斜杠，如 `"C:\\Users\\xxx\\data-transform-mcp\\index.js"`，或用正斜杠也可以。

完整配置示例见 `config.example.json`。

## 两个工具

### `json_to_csv`

把 JSON 对象数组转成 CSV 字符串。

**参数：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `data` | `array<object>` | 是 | JSON 对象数组 |
| `separator` | `string` | 否 | 分隔符，默认 `","`。传 `"\t"` 可生成 TSV |

**行为：**
- 自动生成表头（按字段首次出现的顺序，所有对象的 key 取并集）
- 嵌套对象 / 数组会被 `JSON.stringify()` 序列化为字符串
- 字段内含逗号、双引号、换行时自动加引号包裹（RFC 4180）
- 完整支持中文 / Unicode

**调用示例（对 agent 说）：**

> 把 `[{\"name\":\"张三\",\"age\":30},{\"name\":\"李四\",\"age\":25}]` 转成 CSV

### `csv_to_json`

把 CSV 文本转成 JSON 对象数组。

**参数：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `csv` | `string` | 是 | CSV 文本（首行视为表头） |
| `separator` | `string` | 否 | 分隔符，默认 `","` |

**行为：**
- 首行视为表头，后续行按表头映射为对象
- 自动推断类型：`null` / 布尔 / 数字（含负数、小数、科学计数法）/ JSON 数组/对象 / 字符串
- 前导零数字（如 `"01"`）保留为字符串，不丢精度
- 引号内逗号、换行、doubled 引号均正确解析

**调用示例（对 agent 说）：**

> 把这段 CSV 转成 JSON：`name,age,active\nAlice,30,true\nBob,25,false`

## 往返转换示例

```
原始 JSON:
[
  {"name": "张三", "age": 30, "tags": ["dev", "ai"], "meta": {"city": "北京"}},
  {"name": "李四", "age": 25, "tags": ["design"], "meta": {"city": "上海"}}
]

↓ json_to_csv

name,age,tags,meta
张三,30,"[""dev"",""ai""]","{""city"":""北京""}"
李四,25,"[""design""]","{""city"":""上海""}"

↓ csv_to_json

[
  {"name": "张三", "age": 30, "tags": ["dev", "ai"], "meta": {"city": "北京"}},
  {"name": "李四", "age": 25, "tags": ["design"], "meta": {"city": "上海"}}
]
```

往返无损 ✓

## 安全设计

- **零凭证**：本工具不存储、不硬编码、不传输任何密钥 / 令牌 / 钱包地址
- **纯本地运算**：所有转换在本地完成，不发送任何网络请求
- **无副作用**：不写文件、不执行命令、不访问外部服务

## 定制 / 代搭

需要更多数据转换工具（XML、YAML、Excel）或其他 MCP server 定制？

联系 `cqsj6667@agent.qq.com`｜验收标准先写清 · 不达标不收尾款 · 做完不失联
