# MANET 仿真系统用户手册

本文档面向最终用户，介绍如何使用本系统启动仿真、配置参数、查看结果。

**前置要求**：Linux x86_64 主机，Docker 已安装，具备 sudo 权限。

---

## 1. 快速启动

```bash
cd manet-30ns3

# 启动控制器（FastAPI + Web UI）
docker compose up -d controller
curl -s localhost:8000/api/health      # 返回 {"ok": true} 即正常
```

打开浏览器访问 **http://localhost:8000/** 即可看到 Web 管理面板。

---

## 2. 启动仿真

### 方式一：Web 面板（推荐）

1. 打开 http://localhost:8000/
2. 在 **Dashboard** 或 **Configuration** Tab 中选择预设或调整参数
3. 点击 **Start Simulation**

### 方式二：命令行

```bash
# 使用 debug 预设（5 节点，60 秒，适合快速验证）
curl -X POST localhost:8000/api/sim/start \
  -H 'content-type: application/json' \
  -d '{"preset":"debug"}'

# 使用 default 预设
curl -X POST localhost:8000/api/sim/start \
  -H 'content-type: application/json' \
  -d '{"preset":"default"}'

# 自定义配置
curl -X POST localhost:8000/api/sim/start \
  -H 'content-type: application/json' \
  -d '{
    "config": {
      "nNodes": 10,
      "simulationTime": 300,
      "txPowerStart": 30,
      "pathLossModel": "LogDistance"
    }
  }'
```

### 预设说明

| 预设 | 场景 | 节点数 | 时长 |
|------|------|--------|------|
| `debug` | 快速冒烟测试 | 5 | 60s |
| `default` | 默认配置 | 16 | 600s |
| `urban` | 高密度城市环境 | 16 | 600s |
| `rural` | 开阔野外环境 | 16 | 600s |
| `tactical` | 战术通信场景 | 16 | 600s |

---

## 3. 停止仿真

```bash
curl -X POST localhost:8000/api/sim/stop
```

停止后会**自动清理**所有节点容器、网桥、Veth、TAP 设备，无需手动处理残留。

---

## 4. 查看仿真状态

```bash
# 仿真状态
curl -s localhost:8000/api/sim/status

# 节点列表
curl -s localhost:8000/api/nodes | jq

# 流量统计
curl -s localhost:8000/api/flows | jq

# 实时遥测（WebSocket）
# 可在 Web 面板的 Realtime Tab 中查看
```

---

## 5. 在节点中执行命令

```bash
# 在节点 0 中执行 ping
curl -X POST localhost:8000/api/nodes/0/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"ping -c 4 192.168.100.11"}'

# 启动 iperf3 吞吐测试（服务端在节点 0，客户端在节点 1）
curl -X POST localhost:8000/api/nodes/0/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"iperf3 -s -d"}'

curl -X POST localhost:8000/api/nodes/1/exec \
  -H 'content-type: application/json' \
  -d '{"cmd":"iperf3 -c 192.168.100.10 -t 10"}'
```

---

## 6. 配置参数说明

主要可调参数（通过 REST body 或 Web 面板配置）：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `nNodes` | 节点数量 | 16 |
| `simulationTime` | 仿真时长（秒） | 600 |
| `txPowerStart` | 发射功率（dBm） | 30 |
| `pathLossModel` | 路径损耗模型 | LogDistance |
| `macMode` | MAC 模式（mesh/adhoc） | mesh |
| `mobilityModel` | 移动模型（grid/constant/random） | grid |
| `frequency` | 工作频率（MHz） | 590 |
| `standard` | WiFi 标准 | 80211n-2.4GHz |

---

## 7. 常见问题

### 仿真启动失败

```
curl -X POST localhost:8000/api/sim/start -d '{"preset":"debug"}'
# 返回 error 或超时
```

**排查步骤**：
1. 检查 Docker 是否运行：`docker ps`
2. 检查控制器日志：`docker compose logs controller`
3. 确认内核模块已加载：`lsmod | grep -E 'tun|tap|bridge'`

### 节点间不通

**排查步骤**：
1. 查看节点状态：`curl -s localhost:8000/api/nodes`
2. 检查容器是否在运行：`docker ps | grep manet-node`
3. 在节点内 ping 测试：
   ```bash
   curl -X POST localhost:8000/api/nodes/0/exec \
     -H 'content-type: application/json' \
     -d '{"cmd":"ping -c 3 192.168.100.11"}'
   ```

### 网桥/TAP 残留

```bash
# 检查残留设备
ip link | grep -E 'mesh-|tap-|veth'

# 手动清理（通常自动清理，若异常则）
docker compose down
sudo ip link del mesh-br-0 2>/dev/null
# ... 对每个残留设备重复
```

### 权限不足

pyr oute2 需要创建网络设备，需要以 sudo 运行 Docker 或赋予足够权限：

```bash
docker compose up -d controller  # 需要 sudo
```

---

## 8. Web 面板功能概览

打开 http://localhost:8000/ 后：

- **Dashboard**：仿真状态总览、快捷启动/停止
- **Configuration**：调整仿真参数、选择预设
- **Topology**：查看节点拓扑图
- **Realtime**：实时流量监控
- **Logs**：查看各节点日志

---

## 9. 参考链接

- 详细技术文档：`manet-30ns3/README.md`
- REST API 参考：见 README §7 REST API 速查
- 测试用例：`manet-30ns3/tests/docs/`