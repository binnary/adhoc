# MANET NS-3 容器化仿真系统 — 用户手册

## 目录

- [1. 概述](#1-概述)
- [2. 系统要求](#2-系统要求)
- [3. 安装与启动](#3-安装与启动)
- [4. 快速开始：第一次仿真](#4-快速开始第一次仿真)
- [5. Web 管理面板](#5-web-管理面板)
- [6. 节点管理](#6-节点管理)
- [7. 仿真配置详解](#7-仿真配置详解)
- [8. 远端节点与 VXLAN](#8-远端节点与-vxlan)
- [9. 测试](#9-测试)
- [10. REST API 参考](#10-rest-api-参考)
- [11. 架构原理](#11-架构原理)
- [12. 故障排查](#12-故障排查)
- [13. 常见问题](#13-常见问题)

---

## 1. 概述

本系统是一套**容器化 MANET（移动自组网）仿真平台**。核心能力是将每个 MANET 节点放入独立的 Docker 容器中，并强制所有节点间流量经过 NS-3 的 802.11 信道模型（PHY/MAC/传播/路由）。

### 核心特性

- **每节点独立容器**：`network_mode="none"`，通过 veth + TAP 接入 NS-3
- **两种 MAC 模式**：802.11s Mesh（HWMP L2 多跳）和 802.11 AdHoc（IBSS 单跳）
- **80+ 可配置参数**：频率、带宽、功率、路径损耗、移动模型、路由协议等
- **实时遥测**：节点位置、邻居、吞吐量、延迟，通过 WebSocket 5Hz 推送
- **Web 管理面板**：React 19 前端，实时查看操控
- **远端节点支持**：通过 VXLAN 隧道将远端物理主机纳入仿真网络
- **三种用户软件部署模式**：bind（挂载代码）、image（自定义镜像）、exec（运行时注入）

### 典型应用场景

| 场景 | 预设 | 说明 |
|------|------|------|
| 冒烟测试 | `debug` | 5 节点，Grid 50m，FreeSpace 路径损耗 |
| 城市环境 | `urban` | 高密度，LogDistance n=3.5，Nakagami 衰落 |
| 开阔野外 | `rural` | 大范围，FreeSpace，Grid 8km |
| 战术通信 | `tactical` | UHF 590MHz，TwoRayGround，Tx=37dBm |
| WiFi 频段测试 | `wifi-band-test-2.4g` / `wifi-band-test-5g` | 不同频段基准 |
| 多跳测试 | `wifi-adhoc-multihop` | 大规模拓扑 |

---

## 2. 系统要求

### 硬件要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| 架构 | x86_64 (linux/amd64) | x86_64 |
| CPU | 4 核 | 8 核+ |
| 内存 | 4 GB | 16 GB |
| 磁盘 | 10 GB | 50 GB（含 NS-3 构建）|

### 软件要求

- **操作系统**：Ubuntu 20.04 / 22.04（仅 Linux）
- **Docker**：≥ 20.10
- **内核模块**：`tun`、`tap`、`bridge`
- **远端节点还需**：SSH 访问、远端主机 sudo 权限

### 内核模块加载

```bash
sudo modprobe tun
sudo modprobe tap
sudo modprobe bridge
lsmod | grep -E 'tun|tap|bridge'
```

---

## 3. 安装与启动

本系统提供四种启动方式，按推荐程度排列：

### 方式一：Docker — 本地构建（推荐开发）

克隆仓库并在项目目录内构建镜像：

```bash
git clone https://github.com/clawdbuddy/adhoc.git
cd adhoc/manet-30ns3

# 构建节点镜像
docker compose --profile build build node-image-builder

# 构建控制器镜像（NS-3.47 + cppyy，耗时约 30-60 分钟）
docker compose build controller

# 启动控制器
docker compose up -d controller

# 验证健康
curl localhost:8000/api/health
```

控制器将监听 `0.0.0.0:8000`，Web 面板可直接访问 http://localhost:8000。

### 方式二：Docker — 从 GHCR 拉取（无需源码/构建）

直接从 GitHub Container Registry 拉取预构建镜像：

```bash
# 1. 拉取节点镜像
docker pull ghcr.io/clawdbuddy/manet-node:latest
docker tag ghcr.io/clawdbuddy/manet-node:latest manet-node:latest

# 2. 启动控制器
docker run -d --name controller \
  --privileged --network host --pid host \
  --cap-add NET_ADMIN --cap-add NET_RAW --cap-add SYS_ADMIN \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/run/netns:/var/run/netns \
  -v $(pwd)/results:/results \
  -v $(pwd)/config:/app/config \
  ghcr.io/clawdbuddy/manet-controller:latest

# 3. 验证
curl localhost:8000/api/health
```

> **注意**：
> - 首次启动需拉取镜像，取决于网络约 1-3 分钟
> - 如需停止：`docker stop controller && docker rm controller`
> - 远端主机使用 `host-manet-node` 时，远端也需提前拉取：`docker pull ghcr.io/clawdbuddy/host-manet-node:main`

### 方式三：Conda 物理主机部署

在有 Python 环境的物理主机上直接运行：

```bash
cd manet-30ns3

# 首次安装（系统依赖 + conda 环境 + systemd 服务）
sudo bash setup-controller.sh

# 手动启动
conda activate manet-controller
PYTHONPATH=./controller MANET_WEB_DIR=./web-manager/dist \
  python3 -m uvicorn controller.api.main:app --host 0.0.0.0 --port 8000
```

### 方式四：独立可执行程序

使用 PyInstaller 打包为独立二进制：

```bash
cd manet-30ns3
bash build-controller.sh
./dist/manet-controller/manet-controller
```

---

## 4. 快速开始：第一次仿真

启动控制器后（任一种方式），按以下步骤运行第一次仿真：

### 4.1 启动仿真（5 节点冒烟测试）

```bash
curl -X POST localhost:8000/api/sim/start \
  -H 'content-type: application/json' \
  -d '{"preset":"debug"}'
```

预期返回：`{"ok":true, "running":true, "nNodes":5}`

### 4.2 查看仿真状态

```bash
curl -s localhost:8000/api/sim/status | python3 -m json.tool
```

输出示例：
```json
{
  "running": true,
  "elapsed": 12.34,
  "totalNodes": 5,
  "nodesOnline": 5,
  "preset": "debug",
  "macModeActual": "mesh"
}
```

### 4.3 查看节点列表

```bash
curl -s localhost:8000/api/nodes | python3 -m json.tool
```

每个节点显示：ID、IP、状态、角色、流量统计、邻居列表、坐标位置。

### 4.4 在节点中执行命令

```bash
# 从节点 0 ping 节点 1
curl -s -X POST localhost:8000/api/nodes/0/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"ping -c 4 192.168.100.11"}'

# 吞吐测试（需先在目标节点启动 iperf3 server）
curl -s -X POST localhost:8000/api/nodes/1/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"iperf3 -s -D"}'

curl -s -X POST localhost:8000/api/nodes/0/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"iperf3 -c 192.168.100.11 -t 5"}'
```

### 4.5 查看日志

```bash
# 查看节点 0 的最近 50 条日志
curl 'localhost:8000/api/logs?node=0&tail=50'
```

### 4.6 查看流量统计

```bash
curl -s localhost:8000/api/flows | python3 -m json.tool
```

### 4.7 停止仿真

```bash
curl -X POST localhost:8000/api/sim/stop
```

停止后自动清理：Docker 容器、Linux bridge、veth 对、TAP 接口、VXLAN 隧道。

---

## 5. Web 管理面板

控制器自带 React Web 面板，浏览器打开 http://localhost:8000。

### 面板结构

| 标签页 | 功能 |
|--------|------|
| **Dashboard** | 仿真概览：状态、运行时间、节点数量、预设 |
| **Config** | 80+ 参数配置表单，支持预设加载、.conf 导入导出 |
| **Control** | 启停仿真、预设选择 |
| **Topology** | Canvas 实时拓扑，节点位置、邻居关系、链路质量 |
| **Logs** | 实时日志流，可按节点筛选 |
| **Dynamic** | 运行时动态调整：发射功率、接收灵敏度、通信范围 |
| **Nodes** | 节点规格管理、远端主机注册 |

### 使用流程

1. 打开 http://localhost:8000
2. 在 **Nodes** 页配置节点规格（可跳过，使用默认）
3. 在 **Config** 页调整参数或选择预设
4. 在 **Control** 页点击 Start
5. 在 **Dashboard** 查看进展
6. 在 **Topology** 查看实时拓扑
7. 仿真结束后点击 Stop

---

## 6. 节点管理

### 6.1 节点规格（Node Specs）

节点规格定义每个节点的身份和部署方式：

```json
{
  "id": 0,
  "ip": "192.168.100.10",
  "role": "server",
  "host": "local",
  "hostType": "container",
  "image": "manet-node:latest"
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | int | — | 节点 ID，从 0 开始 |
| `ip` | string | — | MANET 网络 IP 地址 |
| `role` | string | `"client"` | `"server"` 或 `"client"` |
| `host` | string | `"local"` | `"local"` 或远端主机 IP |
| `hostType` | string | `"container"` | `"container"` 或 `"host-manet"` |
| `image` | string | `"manet-node:latest"` | Docker 镜像标签 |

> **重要**：当 `hostType` 不指定时，默认为 `"container"`。如果需要远端主机直接作为节点（而非容器），必须设置 `"hostType": "host-manet"`。

通过 API 查看/更新：

```bash
# 查看
curl -s localhost:8000/api/nodes/specs | jq

# 更新
curl -X PUT localhost:8000/api/nodes/specs \
  -H 'content-type: application/json' \
  -d '{"specs": [{"id":0, "ip":"192.168.100.10", "host":"local", "role":"server"}]}'
```

### 6.2 节点部署模式

| 模式 | host 值 | hostType | 说明 |
|------|---------|----------|------|
| **本地容器** | `"local"` | `"container"` | 默认。控制器所在主机的 Docker 容器 |
| **远端主机节点** | `"<IP>"` | `"host-manet"` | 远端物理主机直接作为节点（`--net=host`） |
| **远端容器** | `"<IP>"` | `"container"` | 远端主机的 Docker 容器 |

### 6.3 用户软件部署

节点容器支持三种用户软件部署模式：

| 模式 | 说明 | 配置方式 |
|------|------|----------|
| **bind** | 挂载本地目录到容器 | `nodeMode: "bind", nodePath: "/path/to/app"` |
| **image** | 使用自定义镜像 | `image: "my-app:latest"` |
| **exec** | 启动后通过 API 注入 | 默认模式，通过 `/api/nodes/{id}/exec` 执行命令 |

### 6.4 镜像版本管理

每个节点可指定独立镜像标签。在 NodeManager UI 或 API 中设置：

```json
{"id": 0, "image": "ghcr.io/clawdbuddy/manet-node:1.1.4"}
```

当镜像不存在时，系统自动执行 `docker pull`。

---

## 7. 仿真配置详解

### 7.1 配置结构与优先级

配置优先级（高 → 低）：
1. 启动请求中的显式 `config` 覆盖
2. `.conf` 配置文件
3. 选定的 `preset`
4. 内置默认值

### 7.2 预设（Presets）

预设是一组预定义的参数集合，方便快速启动不同场景：

```bash
# 查看所有预设
curl -s localhost:8000/api/sim/presets | jq

# 使用预设启动
curl -X POST localhost:8000/api/sim/start \
  -H 'content-type: application/json' \
  -d '{"preset":"debug"}'
```

| 预设 | 节点数 | 场景 | 关键参数 |
|------|--------|------|----------|
| `debug` | 5 | 冒烟测试 | mesh, Grid 50m, FreeSpace, 20dBm, 60s |
| `default` | 10 | 用户默认 | mesh, 5000x5000, FreeSpace, 30dBm, 300s |
| `urban` | 16 | 城市高密度 | mesh, LogDistance n=3.5, Nakagami, 2km |
| `rural` | 8 | 开阔野外 | mesh, FreeSpace, Grid 8km, 无衰落 |
| `tactical` | 8 | 战术通信 | mesh, UHF 590MHz, TwoRayGround, 37dBm |

### 7.3 主要配置参数

#### 网络与拓扑

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `nNodes` | int | 10 | 节点数量 |
| `macMode` | string | `"adhoc"` | `"mesh"` 或 `"adhoc"` |
| `standard` | string | `"80211n-2.4GHz"` | WiFi 标准 |
| `mobilityModel` | string | `"grid"` | `"grid"`, `"random-walk"`, `"random-waypoint"` |
| `simulationTime` | int | 300 | 仿真时长（秒）|

#### 无线信道

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `txPowerStart` | float | 20 | 发射功率（dBm） |
| `txPowerEnd` | float | 20 | 发射功率（结束值，动态变化用）|
| `pathLossModel` | string | `"FreeSpace"` | 路径损耗模型 |
| `frequency` | int | 2412 | 信道频率（MHz）|
| `channelWidth` | int | 20 | 信道带宽（MHz）|
| `rxSensitivity` | float | -82 | 接收灵敏度（dBm）|
| `communicationRange` | float | 150 | 通信范围（米）|

#### 路由

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `routingProtocol` | string | `"AODV"` | 路由协议 |
| `enableBroadcast` | bool | false | 是否启用广播风暴 |
| `meshHwmpMaxHops` | int | 32 | HWMP 最大跳数 |

#### 传播模型

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableFading` | bool | false | 是否启用衰落 |
| `fadingModel` | string | `"Nakagami"` | 衰落模型 |
| `shadowingEnabled` | bool | false | 是否启用阴影效应 |

### 7.4 运行时动态调整

仿真运行中可动态调整部分参数（无需停止仿真）：

```bash
# 调整所有节点的发射功率
curl -X POST localhost:8000/api/dynamic/tx-power \
  -H 'content-type: application/json' \
  -d '{"value": 25}'

# 调整所有节点的接收灵敏度
curl -X POST localhost:8000/api/dynamic/rx-sensitivity \
  -H 'content-type: application/json' \
  -d '{"value": -90}'
```

支持动态调整的参数：发射功率、接收灵敏度、通信范围、信道频率、信道带宽。

---

## 8. 远端节点与 VXLAN

### 8.1 概念

当仿真需要跨多台物理主机时，通过 VXLAN 隧道将远端主机上的节点接入同一仿真网络：

```
远端主机 100.100.100.9              控制器主机
┌─────────────────────┐          ┌─────────────────────┐
│ host-manet-node-1   │          │ mesh-br-1           │
│   └── vxlan-1 ──UDP/4789── vxlan-1 ── mesh-tap-1 ──→ NS-3
│ IP: 192.168.100.11  │          │                     │
└─────────────────────┘          └─────────────────────┘
```

### 8.2 完整流程

#### 步骤 1：注册远端主机

```bash
curl -X POST localhost:8000/api/hosts/register \
  -H 'content-type: application/json' \
  -d '{
    "ip": "100.100.100.9",
    "sshUser": "binnary",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "capacity": 1
  }'
```

SSH key 需为 OpenSSH 格式的私钥内容。容量（capacity）表示该主机可运行的最大节点数。

#### 步骤 2：配置节点规格

```bash
curl -X PUT localhost:8000/api/nodes/specs \
  -H 'content-type: application/json' \
  -d '{
    "specs": [
      {"id": 0, "ip": "192.168.100.10", "host": "local"},
      {"id": 1, "ip": "192.168.100.11", "host": "100.100.100.9", "hostType": "host-manet"}
    ]
  }'
```

> **关键**：hostType 必须设置为 `"host-manet"`。默认值为 `"container"`，会导致 SSH 连接使用错误的用户身份。

#### 步骤 3：启动仿真

```bash
curl -X POST localhost:8000/api/sim/start \
  -H 'content-type: application/json' \
  -d '{
    "preset": "debug",
    "nodes": [
      {"id": 0, "host": "local"},
      {"id": 1, "host": "100.100.100.9", "hostType": "host-manet"},
      {"id": 2, "host": "local"},
      {"id": 3, "host": "local"},
      {"id": 4, "host": "local"}
    ]
  }'
```

启动后自动执行：
1. SSH 连接远端主机
2. 拉取 `ghcr.io/clawdbuddy/host-manet-node:main` 镜像
3. 在远端启动 `--net=host` 容器
4. 检测两端 LAN IP（需在同一 L2 子网）
5. 在两端创建 VXLAN 隧道（VNI=100+节点ID, MTU=1400）
6. 将控制器端 VXLAN 接入对应 mesh bridge
7. 注入所有节点的静态 ARP 条目

### 8.3 前提条件

| 条件 | 说明 |
|------|------|
| SSH 可达 | 控制器需能 SSH 到远端主机 |
| sudo 权限 | 远端用户需有 sudo 权限（创建 VXLAN, Docker）|
| 同一 L2 子网 | 两端 VXLAN 端点 IP 需在同一子网（避免 NAT）|
| UDP/4789 开放 | 两端防火墙需允许 VXLAN 端口 |
| Docker | 远端主机需安装 Docker |
| 镜像预拉取 | 建议提前拉取：`docker pull ghcr.io/clawdbuddy/host-manet-node:main` |

### 8.4 验证远端节点

```bash
# 查看 VXLAN 接口
ip link show vxlan-1

# 在控制器端验证
curl -s localhost:8000/api/nodes | jq '.[] | select(.id==1)'

# ping 测试
curl -s -X POST localhost:8000/api/nodes/0/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"ping -c 4 192.168.100.11"}'

# 在远端主机验证
ssh binnary@100.100.100.9 "docker ps && ip link show vxlan-1 && ping -c 2 192.168.100.10"
```

### 8.5 技术细节

- **隧道端点发现**：自动检测两端 LAN IP，保证在同一 L2 子网
- **MTU 1400**：所有 VXLAN/TAP/veth 接口统一 MTU，避免分片
- **静态 ARP**：由于 mesh + VXLAN 不转发广播，启动时注入所有节点对的静态 ARP
- **自动清理**：仿真停止时，自动删除两端 VXLAN 和远端容器

---

## 9. 测试

### 9.1 WiFi 自动化测试套件

覆盖 8 个典型场景的端到端测试：

```bash
cd manet-30ns3

# 运行全部测试
python3 tests/wifi_test_suite.py

# 运行单个测试
python3 tests/wifi_test_suite.py tc_frequency_2_4g

# 生成 HTML/Markdown 报告
python3 tests/generate_report.py
```

| 用例 | 验证目标 |
|------|----------|
| `tc_frequency_2_4g` | 2.4GHz 频段 5 节点连通性 |
| `tc_frequency_5g` | 5GHz 频段 5 节点连通性 |
| `tc_bandwidth_20m` | 20MHz 带宽吞吐量 |
| `tc_bandwidth_40m` | 40MHz 带宽吞吐量 |
| `tc_distance_attenuation` | 500-2000m 距离衰减 |
| `tc_adhoc_multihop` | 10 节点多跳场景 |
| `tc_broadcast` | 广播覆盖范围 |
| `tc_frequency_sweep` | 多信道遍历测试 |

### 9.2 后端单元测试

```bash
cd manet-30ns3
python3 -m pytest controller/tests/ -v
```

测试套件使用 Mock 模式，无需 Docker 或 NS-3 环境。

### 9.3 前端检查

```bash
cd manet-30ns3/web-manager
npm run lint          # ESLint
npm run build         # TypeScript 类型检查 + Vite 构建
```

### 9.4 手动端到端验证

```bash
# 1. 启动仿真
curl -X POST localhost:8000/api/sim/start \
  -H 'content-type: application/json' \
  -d '{"preset":"debug"}'

# 2. 检查节点上线
curl -s localhost:8000/api/nodes | jq '.[].status'

# 3. 连通性测试
curl -s -X POST localhost:8000/api/nodes/0/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"ping -c 4 192.168.100.11"}'

# 4. 吞吐测试
curl -s -X POST localhost:8000/api/nodes/1/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"iperf3 -s -D"}'
curl -s -X POST localhost:8000/api/nodes/0/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"iperf3 -c 192.168.100.11 -t 5"}'

# 5. 停止
curl -X POST localhost:8000/api/sim/stop

# 6. 验证清理
ip link | grep -E 'mesh-|vxlan-' || echo "clean"
```

---

## 10. REST API 参考

### 10.1 仿真控制

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sim/start` | 启动仿真 |
| POST | `/api/sim/stop` | 停止仿真 |
| GET | `/api/sim/status` | 仿真状态 |
| GET | `/api/sim/presets` | 预设列表 |

**`/api/sim/start` 请求体：**

```json
{
  "preset": "debug",
  "config": {
    "nNodes": 5,
    "simulationTime": 180,
    "standard": "80211n-2.4GHz",
    "macMode": "mesh",
    "mobilityModel": "grid",
    "pathLossModel": "FreeSpace"
  },
  "nodes": [
    {"id": 0, "ip": "192.168.100.10", "host": "local"}
  ]
}
```

### 10.2 节点管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/nodes` | 节点状态列表 |
| GET | `/api/nodes/specs` | 节点规格列表 |
| PUT | `/api/nodes/specs` | 更新节点规格 |
| POST | `/api/nodes/{id}/exec` | 在节点中执行命令 |
| GET | `/api/logs?node={id}` | 查看节点日志 |

### 10.3 远端主机管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/hosts/register` | 注册远端主机 |
| GET | `/api/hosts` | 主机列表 |
| DELETE | `/api/hosts/{ip}` | 删除主机 |

### 10.4 配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 获取当前配置 |
| PUT | `/api/config` | 更新配置 |
| GET | `/api/health` | 健康检查 |

### 10.5 遥测

| 方法 | 路径 | 说明 |
|------|------|------|
| WS | `/ws/telemetry` | WebSocket 实时遥测（5Hz）|

---

## 11. 架构原理

### 11.1 网络架构

```
┌─────────────────────────────────────────────────────────────┐
│                        控制器主机                             │
│  ┌──────────────┐    ┌──────────────────────────────────┐   │
│  │ Docker Socket │    │  NS-3 Simulator                  │   │
│  │              │    │  ┌──────────┐  ┌──────────┐      │   │
│  │ manet-node-0 │    │  │ Tap 0    │  │ Tap 1    │ ...  │   │
│  │   eth0 ──────┼────┼──┤          │  │          │      │   │
│  │              │    │  └────┬─────┘  └────┬─────┘      │   │
│  └──────────────┘    │       │              │            │   │
│                      │  ┌────▼─────┐  ┌────▼─────┐      │   │
│  ┌──────────────┐    │  │ mesh-br-0│  │ mesh-br-1│ ...  │   │
│  │ manet-node-1 │    │  │ ┌─┴──┐    │  │ ┌─┴──┐    │    │   │
│  │   eth0 ──────┼────┼──┤veth│TAP  │  │ │veth│TAP │    │   │
│  │              │    │  └────┘     │  │ └────┘     │    │   │
│  └──────────────┘    └──────────────┘  └──────────────┘   │
│                                        (mesh-tap-)        │
└─────────────────────────────────────────────────────────────┘
```

每个节点独占一个 Linux bridge（`mesh-br-{id}`），桥接三个接口：
- **mesh-veth{id}** ← 容器 eth0（通过 veth pair 连接）
- **mesh-tap-{id}** → NS-3 TapBridge → MeshPointDevice → 802.11 信道
- **vxlan-{id}** ← 远端 VXLAN 隧道（仅远端节点）

### 11.2 数据流

```
容器 eth0 → mesh-veth → mesh-br → mesh-tap → NS-3 TapBridge
  → MeshPointDevice → 802.11s MAC → SpectrumWifiPhy
  → 信道模型（路径损耗/衰落/阴影）
  → 接收端 802.11s MAC → TapBridge → mesh-tap
  → mesh-br → mesh-veth → 目标容器 eth0
```

### 11.3 线程模型

```
┌─────────────────────────────────┐
│         主进程 (uvicorn)         │
│  ┌───────────┐  ┌────────────┐  │
│  │ asyncio   │  │ asyncio    │  │
│  │ FastAPI   │  │ Telemetry  │  │
│  │ 路由处理  │  │ 5Hz 广播   │  │
│  └───────────┘  └────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 守护线程: SimRunner       │  │
│  │ NS-3 Simulator::Run       │  │
│  │ (GIL 释放, 纯 C++ 执行)   │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

### 11.4 网络隔离保证

- 每个节点容器 `network_mode="none"`，无 Docker 默认网桥
- 每节点独占一个 Linux bridge，仅连接该节点的 veth 和 TAP
- 容器间无共享 L2 广播域
- 跨节点流量**只能**通过 NS-3 PHY/MAC 模型转发

---

## 12. 故障排查

### 常见问题

| 现象 | 可能原因 | 解决 |
|------|----------|------|
| `docker run` 后控制器未启动 | 镜像拉取中 | 等待 1-2 分钟，`docker logs controller` 查看进展 |
| 远端容器未启动 | 节点规格中缺少 `hostType: "host-manet"` | 在 node specs 中添加此字段 |
| SSH 连接失败 | host registry 中 key 格式错误 | 确保私钥为 OpenSSH 格式，换行为 `\n` |
| VXLAN 不通 | 两端 LAN IP 不在同一子网 | 检查两端 `ip route get 8.8.8.8` |
| ping 丢包 100% | ARP 未注入 | 检查 ARP 表 `arp -n`，确认有 CM 标志的条目 |
| 容器创建失败 | 镜像不存在 | 检查 node image tag，确保已 pull |
| docker pull 403 | daocloud 镜像代理限制 | 使用 GHCR 全路径：`ghcr.io/clawdbuddy/manet-node:latest` |
| `--privileged` 缺失 | 控制器未以特权模式运行 | 确认容器启动参数含 `--privileged` |
| 仿真启动返回 500 | 参数校验失败 | 检查请求体 JSON 格式，确保 preset 名称正确 |
| 控制器反复重启 | NS-3 崩溃 | 检查 `docker logs controller`，减少节点数或简化配置 |

### 诊断命令

```bash
# 控制器日志
docker logs controller

# 网络接口
ip link | grep -E 'mesh-|vxlan-|tap-'
ip addr show
bridge link show

# ARP 表
arp -n

# 容器列表
docker ps -a --filter name=manet-node

# netns
ls /var/run/netns/

# 远端主机
ssh user@host "docker ps; ip link show vxlan-; ping -c 2 <MANET_IP>"
```

### 清理残留

```bash
# 停止仿真
curl -X POST localhost:8000/api/sim/stop

# 删除残留容器
docker rm -f $(docker ps -aq --filter name=manet-node) 2>/dev/null

# 删除残留网络接口
for iface in $(ip link | grep -oE 'mesh-(br|veth|tap)-[0-9]+|vxlan-[0-9]+'); do
  sudo ip link delete $iface 2>/dev/null
done
```

---

## 13. 常见问题

### Q: 为什么需要 `--privileged --network host --pid host`？
容器内部需要操作宿主机网络栈（创建 bridge、veth、TAP、netns），以及通过 Docker socket 管理其他容器。

### Q: 可以在 macOS 上运行吗？
不能。本系统涉及 Linux 特有的内核网络操作（pyroute2、netns、TAP），仅在 Linux x86_64 上支持。

### Q: 仿真时间和真实时间的关系？
NS-3 默认以仿真时间运行，速度取决于拓扑复杂度。典型场景：10 节点 mesh 约 1:20-1:30 倍速（300 秒仿真约需 10-15 秒真实时间）。

### Q: 如何持久化配置？
主机注册信息和节点规格自动持久化到 `manet-30ns3/config/` 目录（JSON 文件），容器重启后自动恢复。

### Q: 哪些参数可以运行时动态调整？
发射功率、接收灵敏度、通信范围、信道频率、信道带宽。其他参数需停止仿真后重新启动。

### Q: 最多支持多少个节点？
取决于宿主机资源。典型限制：Docker 容器约 16-20 个，NS-3 仿真约 30-50 个。建议不超过 20 个节点。

### Q: 如何升级到新版本？
```bash
# Docker 方式：拉取新镜像，重建容器
docker compose pull controller
docker rm -f controller
docker compose up -d controller

# GHCR 方式：拉取新镜像，删除旧容器，重新运行
docker pull ghcr.io/clawdbuddy/manet-controller:latest
docker stop controller && docker rm controller
# 重新执行 docker run 命令
```

---

> 更多信息请参阅：
> - `manet-30ns3/README.md` — 项目级文档
> - `AGENTS.md` — 开发者笔记
> - `docs/MANET-需求方案-v2.0.md` — 需求规格说明
