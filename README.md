# 世界杯话题雷达

一个面向内容运营的世界杯相关话题榜单。它会自动抓取国内平台/中文内容源中与 **世界杯、世预赛、国足、FIFA、美加墨世界杯** 相关的话题，并按平台分别展示。

默认平台：

- 微博
- 百度
- B站
- 知乎
- 抖音
- 虎扑
- 懂球帝
- 小红书
- 咪咕
- 网易

## 你会看到什么

页面不再做“影视/体育双 Tab”，而是每个平台一个 Tab。每个 Tab 下列出该平台命中的世界杯相关话题。

每条话题包含：

- 话题标题
- 命中摘要
- 相关词标签
- 热度分
- 来源入口和排名
- 抓取诊断

## 部署步骤

1. 新建 GitHub 仓库，例如：`worldcup-topic-radar`。
2. 解压本 ZIP，把里面所有文件上传到仓库根目录。
3. 进入仓库 `Settings -> Pages`。
4. Source 选择 `GitHub Actions`。
5. 进入 `Actions -> Update World Cup Radar -> Run workflow`，手动运行一次。
6. 绿色对勾后打开 Pages 地址。

你的访问地址一般是：

```text
https://你的GitHub用户名.github.io/仓库名/
```

如果你的仓库叫 `worldcup-topic-radar`，地址就是：

```text
https://你的GitHub用户名.github.io/worldcup-topic-radar/
```

## 自动更新

`.github/workflows/update.yml` 已配置每小时自动运行一次。

如果要调整更新频率，修改：

```yaml
schedule:
  - cron: '0 * * * *'
```

GitHub Actions 的 cron 使用 UTC 时间。

## 主要配置文件

### `config/worldcup.config.json`

你最常改的是这个文件。

里面可以改：

- 平台列表
- 数据源列表
- 世界杯关键词
- 排除词
- 每个平台最多展示数量

例如要增加关键词，在：

```json
"mustIncludeAny": []
```

里追加：

```json
"世界杯开幕式", "世界杯吉祥物", "世界杯官方用球"
```

### `scripts/update.js`

核心抓取和过滤逻辑。

已经做了这些处理：

- 只保留世界杯相关内容
- 排除篮球世界杯、电竞世界杯、博彩、促销等误伤内容
- 同平台去重
- 同标题跨来源合并
- 来源失败不影响整体运行
- 抓不到真实数据时展示示例数据，避免页面空白

## RSSHub 配置

默认使用：

```text
https://rsshub.app
```

如果不稳定，可以在 GitHub 仓库里配置变量：

```text
Settings -> Secrets and variables -> Actions -> Variables -> New repository variable
```

变量名：

```text
RSSHUB_BASE
```

变量值可以填你的自建 RSSHub 或可用公共实例，例如：

```text
https://rsshub.rssforever.com
```

## 来源说明

当前采用“多源容错”策略：

- 有公开接口的，用公开接口。
- 有 RSSHub 路由的，用 RSSHub。
- 没有稳定公开接口的平台，用百度搜索补充，例如 `site:xiaohongshu.com 世界杯`。
- 抖音、小红书、咪咕这类平台公开抓取不稳定，所以保留为“尽力抓取 + 搜索补充”。

## 文件结构

```text
.github/workflows/update.yml  GitHub Actions 自动更新和部署
config/worldcup.config.json   平台、来源、关键词配置
config/fallback-sample.json   无网络或抓取失败时的示例数据
scripts/update.js             抓取、过滤、去重、打分脚本
public/index.html             页面入口
public/app.js                 前端渲染逻辑
public/styles.css             页面样式
public/data/worldcup.json     页面展示数据，Actions 每次自动生成
package.json                  Node 依赖和脚本
```

## 本地测试

```bash
npm install
npm run update
npm run serve
```

然后打开：

```text
http://localhost:8080
```

## 常见问题

### 页面 404

确认：

1. `Settings -> Pages -> Source` 是 `GitHub Actions`。
2. Actions 已经跑出绿色对勾。
3. 访问地址包含仓库名，例如 `/worldcup-topic-radar/`。

### 某个平台没有内容

原因通常是：

- 该平台当天没有命中世界杯话题。
- 该平台接口/页面反爬。
- RSSHub 当前实例不可用。

可以尝试：

1. 等下一小时自动更新。
2. 配置 `RSSHUB_BASE` 换一个 RSSHub 实例。
3. 在 `config/worldcup.config.json` 里给该平台增加搜索来源。

### 为什么小红书、抖音、咪咕不一定稳定？

这些平台没有面向公开网页的稳定 RSS/开放搜索接口，且反爬较强。本项目采用搜索补充方式，能抓到时就展示，抓不到也不会影响其他平台。
