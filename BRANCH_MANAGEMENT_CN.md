# Codex-Proxy 项目分支管理规范

## 1. 文档说明

本文档用于规范 `enilu/codex-proxy` 个人 Fork 仓库的分支管理、上游同步和个性化定制开发流程。

当前仓库以 `icebear0828/codex-proxy` 作为上游源码来源，在个人 Fork 中维护一个纯镜像底座分支和一个定制稳定分支，避免上游代码与个人定制代码相互污染。

仓库地址：

| 类型 | 仓库地址 |
| --- | --- |
| 上游原始仓库 | <https://github.com/icebear0828/codex-proxy.git> |
| 个人 Fork 仓库 | <https://github.com/enilu/codex-proxy.git> |

## 2. 分支架构

采用“上游镜像分支 + 定制主分支 + 单点功能分支”的三层结构。

| 分支名 | 分支类型 | 核心职责 | 操作约束 |
| --- | --- | --- | --- |
| `dev` | 上游镜像分支 | 同步原项目最新代码，作为所有定制分支的代码底座 | 禁止提交个性化代码，仅接收上游更新 |
| `custom-profile` | 定制主分支 | 汇总所有个性化功能，作为个人稳定可用版本 | 只合并 `dev` 和 `feature/*`，不直接开发新功能 |
| `feature/*` | 单点功能分支 | 承载单个个性化需求或功能开发 | 一个分支只做一项定制，完成合并后可删除 |

分支流转关系：

```text
上游仓库 icebear0828/codex-proxy:dev
        |
        | 定期同步
        v
个人仓库 enilu/codex-proxy:dev（纯镜像）
        |
        | 合并更新
        v
个人仓库 enilu/codex-proxy:custom-profile（定制总分支）
        |
        | 拉出功能分支
        v
个人仓库 enilu/codex-proxy:feature/xxx（单点定制分支）
```

## 3. 首次初始化

首次克隆个人 Fork 仓库后，需要补充上游远程仓库。

```bash
# 1. 克隆个人 Fork 仓库
git clone https://github.com/enilu/codex-proxy.git
cd codex-proxy

# 2. 添加上游原始仓库
git remote add upstream https://github.com/icebear0828/codex-proxy.git

# 3. 校验远程仓库，应能看到 origin 和 upstream
git remote -v
```

如果仓库已经存在但缺少 `upstream`，只需执行：

```bash
git remote add upstream https://github.com/icebear0828/codex-proxy.git
git remote -v
```

## 4. 日常操作流程

### 4.1 定期同步上游代码

建议每周同步 1 到 2 次，用于拉取原项目最新功能和修复。

`dev` 是纯镜像分支，推荐使用 `fetch + ff-only merge`，避免在镜像分支上产生不必要的合并提交。

```bash
# 1. 拉取远程引用
git fetch upstream
git fetch origin

# 2. 切换到镜像分支 dev
git switch dev

# 3. 仅允许快进合并上游 dev
git merge --ff-only upstream/dev

# 4. 推送到个人仓库远端 dev
git push origin dev

# 5. 将最新 dev 合并到定制主分支 custom-profile
git switch custom-profile
git merge dev

# 6. 推送定制主分支
git push origin custom-profile
```

如果 `git merge --ff-only upstream/dev` 失败，说明本地 `dev` 已经不是纯上游镜像，先不要继续操作，应检查 `dev` 是否误提交了个性化代码。

### 4.2 新建个性化功能分支

所有个性化开发统一从 `custom-profile` 拉出分支。

```bash
# 1. 切换至定制主分支，并保证代码最新
git switch custom-profile
git pull --ff-only origin custom-profile

# 2. 创建并进入单点功能分支
git switch -c feature/personal-config
```

命名示例：

```text
feature/personal-config
feature/ui-optimize
feature/self-rule
```

### 4.3 功能开发与提交

在 `feature/*` 分支完成编码和自测后提交代码。

```bash
git add .
git commit -m "feat: 描述本次定制内容"
git push -u origin feature/personal-config
```

### 4.4 合并功能至定制主分支

功能测试通过后，合并回 `custom-profile`。

```bash
# 1. 切回定制主分支
git switch custom-profile
git pull --ff-only origin custom-profile

# 2. 合并功能分支
git merge feature/personal-config

# 3. 推送远端
git push origin custom-profile
```

### 4.5 清理临时功能分支

功能分支合并完成后，可删除本地和远端临时分支，保持仓库整洁。

```bash
# 删除本地分支
git branch -d feature/personal-config

# 删除远端分支
git push origin --delete feature/personal-config
```

### 4.6 开发中途同步上游

如果正在 `feature/*` 分支开发时，上游发布新版本：

1. 先执行“4.1 定期同步上游代码”，更新 `dev` 和 `custom-profile`。
2. 再切回当前功能分支，合并最新 `custom-profile`。

```bash
git switch feature/personal-config
git merge custom-profile
```

解决冲突并完成自测后，继续开发即可。

## 5. 冲突处理

同步 `dev` 到 `custom-profile`，或合并 `feature/*` 到 `custom-profile` 时，如果出现冲突：

```bash
# 1. 查看冲突文件
git status

# 2. 手动编辑冲突文件并完成自测

# 3. 标记冲突已解决
git add <冲突文件>

# 4. 完成合并提交
git commit

# 5. 推送结果
git push origin custom-profile
```

不要在 `dev` 分支上处理个性化冲突。`dev` 应始终保持为上游镜像。

## 6. 强制规范

1. `dev` 分支只读：严禁在 `dev` 分支编写、提交个性化代码。
2. 单向合并：只允许 `upstream/dev -> dev -> custom-profile -> feature/*` 的代码流向。
3. 禁止反向污染：不得将 `custom-profile` 或 `feature/*` 合并回 `dev`。
4. 功能分支小而清晰：一个 `feature/*` 分支只实现一个独立定制功能。
5. 命名统一：功能分支使用 `feature/` 前缀，名称使用英文小写和连字符。
6. 同步要及时：不要长期不同步上游，减少后续大规模冲突。
7. 合并前先自测：功能分支合并到 `custom-profile` 前，应至少完成本地启动或相关测试。

## 7. 常用检查命令

```bash
# 查看当前分支和工作区状态
git status --short --branch

# 查看本地和远端分支
git branch -a

# 查看远程仓库配置
git remote -v

# 查看待合并差异
git diff --stat custom-profile..feature/personal-config
```

## 8. 常用分支清单

| 用途 | 分支 |
| --- | --- |
| 上游镜像分支 | `dev` |
| 定制稳定主分支 | `custom-profile` |
| 临时功能分支 | `feature/*` |

