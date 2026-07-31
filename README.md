# zhaowl94.github.io

[English](README.en.md)

一个无框架、无追踪、可直接打开的开源工程作品集。站点展示 `zhaowl94` 已完成验证的公开项目，重点关注兼容迁移、数据工具与可访问静态前端。

上线地址：[https://zhaowl94.github.io/](https://zhaowl94.github.io/)

## 设计边界

- 只使用公开账号名 `zhaowl94`，不展示真实姓名、邮箱、电话、所在地或私人经历。
- 不读取 GitHub API，不展示私有仓库，也不把第三方历史 fork 当作个人作品。
- 不使用 Cookie、访问统计、广告、第三方脚本、远程字体或联系表单。
- 页面不依赖框架或运行时构建；`index.html` 可直接打开、通过本地 HTTP 提供，也可原样部署到 GitHub Pages。
- 中文为默认语言，`?lang=en` 提供完整英文版本；语言选择不写入 Cookie 或本地存储。

## 站点结构

```text
.
├── index.html
├── 404.html
├── assets/
│   ├── images/
│   ├── scripts/
│   └── styles/
├── scripts/
│   └── Lighthouse 检查
├── test/
│   ├── e2e/
│   ├── scripts/
│   ├── snapshots/
│   └── unit/
├── robots.txt
└── sitemap.xml
```

## 本地查看

最简单的方法是直接打开 `index.html`。此模式会加载本地 CSS、JavaScript 和 favicon，语言切换也保持可用。

若希望使用本地 HTTP：

```powershell
npm.cmd ci
npm.cmd run serve
```

然后访问 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。

项目要求 Node.js 24 LTS。所有工具均安装在仓库内，不要求全局 npm 包，也不会修改 Windows 环境变量、执行策略或全局 Git 配置。

## 验证

```powershell
# 格式、HTML/CSS/JavaScript、静态结构与隐私边界
npm.cmd run check

# 纯函数和 Lighthouse 采样逻辑
npm.cmd run test:unit

# Windows 浏览器矩阵
npm.cmd run test:e2e:windows

# 外部链接和 Lighthouse 预算
npm.cmd run check:external-links
npm.cmd run test:lighthouse
```

Linux 或 WSL 使用相同命令时，可将 `npm.cmd` 写成 `npm`。完整测试范围、浏览器矩阵和人工检查见 [`test/README.md`](test/README.md)。

Lighthouse 的 performance、accessibility、best practices 和 SEO 阈值均为 `0.95`。若第一次采样低于任一阈值，只对该页面补充两次采样并取三次中位数；阈值不会降低。

## 发布

Pull Request 必须通过 Windows、Ubuntu、浏览器矩阵和 Lighthouse。合并到 `master` 后，GitHub Actions 会重新验证并将仓库中的静态源码直接部署到 GitHub Pages，不生成或提交另一份站点源码。

## 开发说明

本站的范围梳理、实现、测试和文档由 Codex 协助完成，最终决策与发布由仓库维护者确认。`assets/images/social-preview.png` 使用内置 ImageGen 生成；提示词和资源授权说明见 [`assets/images/README.md`](assets/images/README.md)。

## 许可证

HTML、CSS、JavaScript、测试和配置代码采用 [MIT License](LICENSE)。个人介绍、项目描述以及 `assets/images/` 中的原创视觉资源不包含在 MIT 授权中，除非资源目录另有说明。
