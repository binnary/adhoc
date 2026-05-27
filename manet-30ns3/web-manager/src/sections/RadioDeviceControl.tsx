import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Radio, Settings2, Send, CheckCircle, AlertCircle,
  Antenna, Zap, Wifi, Gauge, Signal,
} from 'lucide-react';

const PROTOCOL_HOST = '192.0.3.1';
const PROTOCOL_PORT = 62450;

// ---------------------------------------------------------------------
// Protocol framing helpers
// ---------------------------------------------------------------------

interface FrameResult {
  ok: boolean;
  msg: string;
  raw?: string;
}

/** Build a UDP frame per api_54.docx §3.2.1 */
function buildFrame(
  commType: 1 | 2 | 3,
  signalId: number,
  payload: Uint8Array
): Uint8Array {
  const infoLen = payload.length;
  const frame = new Uint8Array(7 + infoLen);
  // Byte 0: comm type
  frame[0] = commType;
  // Byte 1: reserved = 0
  frame[1] = 0;
  // Byte 2: reserved = 0
  frame[2] = 0;
  // Bytes 3-4: signal ID (network byte order)
  frame[3] = (signalId >> 8) & 0xff;
  frame[4] = signalId & 0xff;
  // Bytes 5-6: info length (network byte order)
  frame[5] = (infoLen >> 8) & 0xff;
  frame[6] = infoLen & 0xff;
  // Payload
  frame.set(payload, 7);
  return frame;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars

/** Convert a number to 2-byte big-endian */
function toBe2(v: number) {
  return Uint8Array.from([(v >> 8) & 0xff, v & 0xff]);
}

/** Convert a number to 1-byte big-endian */
function toBe1(v: number) {
  return Uint8Array.from([v & 0xff]);
}

/** Bytes to hex string */
function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// ---------------------------------------------------------------------
// Mode / rate tables from the doc
// ---------------------------------------------------------------------

const WORK_MODE_MAP: Record<number, string> = {
  0: '定频', 1: '跳频', 2: 'FCS',
  3: '定-密', 4: '跳-密', 5: 'FCS-密',
};

const RATE_MAP: Record<number, string> = {
  0: '速率自适应', 1: '窄512kbps', 2: '窄1Mbps', 3: '窄2Mbps',
  4: '宽2Mbps', 5: '宽4Mbps', 6: '宽8Mbps', 7: '宽10Mbps',
  8: '宽16Mbps', 9: '窄4Mbps', 10: '2Mbps', 11: '4Mbps',
  12: '5Mbps', 13: '8Mbps', 14: '10Mbps', 15: '宽20Mbps',
  16: '64k', 17: '512k', 18: '2M',
};

const POWER_MAP: Record<number, string> = {
  4: '功率自适应', 3: '值守', 2: '小功率', 1: '中功率', 0: '大功率',
};

// ---------------------------------------------------------------------
// Freq helpers
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars

/** Convert MHz float → 4-byte compressed BCD */
function mhzToBcd(mhz: number): Uint8Array {
  const khz = Math.round(mhz * 1000);
  const d0 = Math.floor(khz / 1000000) & 0x0f;
  const d1 = Math.floor((khz % 1000000) / 10000) & 0xff;
  const d2 = Math.floor((khz % 10000) / 100) & 0xff;
  const d3 = Math.floor(khz % 100) & 0xff;
  return Uint8Array.from([d0, d1, d2, d3]);
}

// ---------------------------------------------------------------------
// Actual send helper (browser WebSocket → controller WS → radio)
// ---------------------------------------------------------------------

async function sendUdp(frame: Uint8Array, host: string, port: number): Promise<FrameResult> {
  try {
    const res = await fetch('/api/radio/raw', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host, port, frame: Array.from(frame) }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, msg: data.reason || '发送失败' };
    if (data.reply) {
      return { ok: true, msg: `回复: ${toHex(Uint8Array.from(data.reply))}`, raw: toHex(Uint8Array.from(data.reply)) };
    }
    return { ok: true, msg: '发送成功（无回复）' };
  } catch (e) {
    return { ok: false, msg: (e as Error).message };
  }
}

// ---------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------

function ResultBanner({ result }: { result: FrameResult | null }) {
  if (!result) return null;
  return (
    <div className={`rounded-xl border p-3.5 text-sm flex items-center gap-2.5 animate-scale-in ${
      result.ok ? 'border-green-200 bg-green-50/80 text-green-800' : 'border-red-200 bg-red-50/80 text-red-800'
    }`}
    >
      {result.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      <span className="font-mono text-xs break-all">{result.msg}</span>
    </div>
  );
}

interface StaticParamsProps {
  host: string;
  port: number;
}

function StaticParamsTab({ host, port }: StaticParamsProps) {
  const [netScale, setNetScale] = useState('16');
  const [workMode, setWorkMode] = useState(0);
  const [macAddr, setMacAddr] = useState('0');
  const [freqMhz, setFreqMhz] = useState('505.54');
  const [hopTable, setHopTable] = useState('0');
  const [result, setResult] = useState<FrameResult | null>(null);

  const sendFrame = useCallback(
    async (_desc: string, signalId: number, payload: Uint8Array) => {
      const r = await sendUdp(buildFrame(1, signalId, payload), host, port);
      setResult(r);
      return r;
    },
    [host, port]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200/60 bg-slate-50/60 p-4 text-slate-700 text-xs flex items-start gap-3">
        <Antenna className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <span>静态参数由 <strong>波形软件</strong> 管理，设置后需重启生效。</span>
      </div>

      {/* 静态参数设置 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 网络规模 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              网络规模 (0x0001)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">节点数 (2-128)</Label>
              <Input
                type="number"
                value={netScale}
                onChange={e => setNetScale(e.target.value)}
                min={2} max={128}
                className="h-9 mt-1.5 font-mono"
              />
            </div>
            <Button size="sm" className="w-full gap-1.5"
              onClick={async () => {
                const v = parseInt(netScale);
                if (v < 2 || v > 128) { setResult({ ok: false, msg: '范围: 2-128' }); return; }
                await sendFrame('网络规模', 0x0001, toBe2(v));
              }}>
              <Send className="h-3.5 w-3.5" /> 设置
            </Button>
          </CardContent>
        </Card>

        {/* 工作模式 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              工作模式 (0x0002)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(WORK_MODE_MAP).map(([k, v]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={workMode === parseInt(k) ? 'default' : 'outline'}
                  onClick={() => setWorkMode(parseInt(k))}
                >{v}</Button>
              ))}
            </div>
            <Button size="sm" className="w-full gap-1.5"
              onClick={() => sendFrame('工作模式', 0x0002, toBe1(workMode))}>
              <Send className="h-3.5 w-3.5" /> 设置
            </Button>
          </CardContent>
        </Card>

        {/* MAC 地址 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              MAC 地址 (0x0003)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">MAC (0-127)</Label>
              <Input
                type="number"
                value={macAddr}
                onChange={e => setMacAddr(e.target.value)}
                min={0} max={127}
                className="h-9 mt-1.5 font-mono"
              />
            </div>
            <Button size="sm" className="w-full gap-1.5"
              onClick={async () => {
                const v = parseInt(macAddr);
                if (v < 0 || v > 127) { setResult({ ok: false, msg: '范围: 0-127' }); return; }
                await sendFrame('MAC地址', 0x0003, toBe2(v));
              }}>
              <Send className="h-3.5 w-3.5" /> 设置
            </Button>
          </CardContent>
        </Card>

        {/* 定频频率 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Signal className="h-4 w-4 text-primary" />
              定频频率 (0x0004)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">频率 MHz (480~650 / 1410~1710)</Label>
              <Input
                type="number"
                value={freqMhz}
                onChange={e => setFreqMhz(e.target.value)}
                step={0.01}
                className="h-9 mt-1.5 font-mono"
              />
            </div>
            <Button size="sm" className="w-full gap-1.5"
              onClick={() => {
                const v = parseFloat(freqMhz);
                if (v < 480 || v > 1710) { setResult({ ok: false, msg: '频率范围: 480~650 或 1410~1710 MHz' }); return; }
                sendFrame('定频频率', 0x0004, mhzToBcd(v));
              }}>
              <Send className="h-3.5 w-3.5" /> 设置
            </Button>
          </CardContent>
        </Card>

        {/* 跳频表号 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              跳频表号 (0x0005)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">表号 (0-19)</Label>
              <Input
                type="number"
                value={hopTable}
                onChange={e => setHopTable(e.target.value)}
                min={0} max={19}
                className="h-9 mt-1.5 font-mono"
              />
            </div>
            <Button size="sm" className="w-full gap-1.5"
              onClick={async () => {
                const v = parseInt(hopTable);
                if (v < 0 || v > 19) { setResult({ ok: false, msg: '范围: 0-19' }); return; }
                await sendFrame('跳频表号', 0x0005, toBe1(v));
              }}>
              <Send className="h-3.5 w-3.5" /> 设置
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 静态参数查询 */}
      <Separator />
      <h3 className="text-sm font-semibold">静态参数查询</h3>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: '网络规模', id: 0x0041 },
          { label: '工作模式', id: 0x0042 },
          { label: 'MAC地址', id: 0x0043 },
          { label: '定频频率', id: 0x0044 },
          { label: '跳频表号', id: 0x0045 },
        ].map(({ label, id }) => (
          <Button key={id} size="sm" variant="outline" className="gap-1.5"
            onClick={() => sendFrame(label, id, new Uint8Array())}>
            <Send className="h-3.5 w-3.5" /> 查询{label}
          </Button>
        ))}
      </div>

      <ResultBanner result={result} />
    </div>
  );
}

interface DynamicParamsProps {
  host: string;
  port: number;
}

function DynamicParamsTab({ host, port }: DynamicParamsProps) {
  const [rate, setRate] = useState(0);
  const [power, setPower] = useState(0);
  const [result, setResult] = useState<FrameResult | null>(null);

  const sendFrame = useCallback(
    async (_desc: string, signalId: number, payload: Uint8Array) => {
      const r = await sendUdp(buildFrame(3, signalId, payload), host, port);
      setResult(r);
      return r;
    },
    [host, port]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green-200/60 bg-green-50/60 p-4 text-green-700 text-xs flex items-start gap-3">
        <Zap className="h-4 w-4 shrink-0 mt-0.5" />
        <span>动态参数由 <strong>测控链波形</strong> 管理，设置后立即生效。</span>
      </div>

      {/* 传输速率 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4 text-amber-500" />
            传输速率 (0x0101)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
            {Object.entries(RATE_MAP).map(([k, v]) => (
              <Button
                key={k}
                size="sm"
                variant={rate === parseInt(k) ? 'default' : 'outline'}
                onClick={() => setRate(parseInt(k))}
                className="text-xs"
              >{v}</Button>
            ))}
          </div>
          <Button size="sm" className="w-full gap-1.5"
            onClick={() => sendFrame('传输速率', 0x0101, toBe1(rate))}>
            <Send className="h-3.5 w-3.5" /> 设置
          </Button>
        </CardContent>
      </Card>

      {/* 发射功率 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            发射功率 (0x0102)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>大功率</span>
            <Badge variant="outline" className="font-mono">{POWER_MAP[power]}</Badge>
            <span>功率自适应</span>
          </div>
          <Slider
            value={[power]}
            onValueChange={v => setPower(v[0])}
            min={0} max={4}
            step={1}
            disabled={false}
          />
          <div className="grid grid-cols-5 gap-1 mt-2">
            {Object.entries(POWER_MAP).map(([k, v]) => (
              <Button key={k} size="sm" variant={power === parseInt(k) ? 'default' : 'outline'}
                onClick={() => setPower(parseInt(k))} className="text-xs">{v}</Button>
            ))}
          </div>
          <Button size="sm" className="w-full gap-1.5"
            onClick={() => sendFrame('发射功率', 0x0102, toBe1(power))}>
            <Send className="h-3.5 w-3.5" /> 设置
          </Button>
        </CardContent>
      </Card>

      {/* 动态参数查询 */}
      <Separator />
      <h3 className="text-sm font-semibold">动态参数查询</h3>
      <div className="grid grid-cols-2 gap-3">
        <Button size="sm" variant="outline" className="gap-1.5"
          onClick={() => sendFrame('传输速率', 0x0141, new Uint8Array())}>
          <Send className="h-3.5 w-3.5" /> 查询传输速率
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5"
          onClick={() => sendFrame('发射功率', 0x0142, new Uint8Array())}>
          <Send className="h-3.5 w-3.5" /> 查询发射功率
        </Button>
      </div>

      <ResultBanner result={result} />
    </div>
  );
}

interface StatusTabProps {
  host: string;
  port: number;
}

function StatusTab({ host, port }: StatusTabProps) {
  const [result, setResult] = useState<FrameResult | null>(null);

  const sendFrame = useCallback(
    async (_desc: string, signalId: number, payload: Uint8Array, commType: 1 | 2 | 3 = 1) => {
      const r = await sendUdp(buildFrame(commType, signalId, payload), host, port);
      setResult(r);
      return r;
    },
    [host, port]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Button size="sm" variant="outline" className="h-12 gap-2"
          onClick={() => sendFrame('版本信息', 0x0203, new Uint8Array())}>
          <Settings2 className="h-4 w-4" /> 版本信息查询
        </Button>
        <Button size="sm" variant="outline" className="h-12 gap-2"
          onClick={() => sendFrame('节点拓扑', 0x0310, new Uint8Array())}>
          <Antenna className="h-4 w-4" /> 自组网拓扑查询
        </Button>
        <Button size="sm" variant="outline" className="h-12 gap-2"
          onClick={() => sendFrame('主动上报订阅', 0x02AF, new Uint8Array([1, 1, 1, 0, 0, 0, 0]))}>
          <Signal className="h-4 w-4" /> 订阅主动上报
        </Button>
      </div>

      <ResultBanner result={result} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------

export function RadioDeviceControl() {
  const [host, setHost] = useState(PROTOCOL_HOST);
  const [port, setPort] = useState(PROTOCOL_PORT.toString());

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* 连接配置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            电台连接配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end flex-wrap">
            <div>
              <Label className="text-xs text-muted-foreground">目标 IP</Label>
              <Input
                value={host}
                onChange={e => setHost(e.target.value)}
                className="h-9 mt-1.5 font-mono w-44"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">端口</Label>
              <Input
                value={port}
                onChange={e => setPort(e.target.value)}
                type="number"
                className="h-9 mt-1.5 font-mono w-28"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              协议帧格式：通信类型(1B) + 预留(1B) + 预留(1B) + 信令ID(2B) + 信息长度(2B) + 信息内容(NB)
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 主动上报信息说明 */}
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 p-4 text-amber-800 text-sm flex items-center gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
        <span>
          <strong>主动上报 (0x02AF)</strong>：基带波形加载后，按 <strong>5 秒周期</strong>主动上报状态信息。
          BYTE[0]=1 表示启用，BYTE[1]=1 表示 ZZW 同步，BYTE[2]=1 表示 CKL 同步。
          拓扑查询 (0x0310) 返回节点对，每条链路 5 字节：源MAC(2B) + 目的MAC(2B) + 链路质量(1B，FF=未知)。
        </span>
      </div>

      <Tabs defaultValue="static" className="w-full">
        <TabsList className="grid grid-cols-3 w-fit">
          <TabsTrigger value="static">静态参数</TabsTrigger>
          <TabsTrigger value="dynamic">动态参数</TabsTrigger>
          <TabsTrigger value="status">状态查询</TabsTrigger>
        </TabsList>

        <TabsContent value="static">
          <StaticParamsTab host={host} port={parseInt(port)} />
        </TabsContent>

        <TabsContent value="dynamic">
          <DynamicParamsTab host={host} port={parseInt(port)} />
        </TabsContent>

        <TabsContent value="status">
          <StatusTab host={host} port={parseInt(port)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}