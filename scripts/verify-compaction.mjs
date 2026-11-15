#!/usr/bin/env node
/**
 * C11-03 本地验收：压缩策略配置的校验、序列化（settings 形态）与 /compact 焦点参数。
 * 纯本地、不启宿主；失败 exit(1)。
 */
import {
  DEFAULT_COMPACTION, compactInvocation, deserializeCompaction, normalizeCompaction,
  serializeCompaction, toSettingsJson, validateCompaction,
} from '../packages/evolution/src/index.ts'

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

check(validateCompaction(DEFAULT_COMPACTION).ok === true, '默认配置合法')
check(validateCompaction({ triggerRatio: 1.5 }).ok === false, '触发阈值越界被拒')
check(validateCompaction({ keepPolicy: 'bogus' }).ok === false, '非法保留策略被拒')
check(validateCompaction({ headKeepRatio: 0.8, tailKeepRatio: 0.5 }).ok === false, '头尾保留之和 >1 被拒')

let threw = false
try {
  normalizeCompaction({ pruneThresholdBytes: -1 })
} catch {
  threw = true
}
check(threw, 'normalize 对非法值抛错')

const config = normalizeCompaction({ triggerRatio: 0.6, compactFocus: '支付模块' })
check(config.triggerRatio === 0.6, '自定义触发阈值生效')
check(config.pruneThresholdBytes === DEFAULT_COMPACTION.pruneThresholdBytes, '缺省字段补默认值')

const shape = serializeCompaction(config)
check(shape.compaction.triggerRatio === 0.6, '序列化为 settings 形态')
check(deserializeCompaction(shape).compactFocus === '支付模块', 'settings 往返不丢焦点参数')
check(JSON.parse(toSettingsJson(config)).compaction.keepPolicy === DEFAULT_COMPACTION.keepPolicy,
  'toSettingsJson 是可解析的合法 JSON')

check(compactInvocation(config).focus === '支付模块', '/compact 带上焦点参数')
check(compactInvocation(DEFAULT_COMPACTION).focus === undefined, '无焦点时不带该参数')

process.stdout.write(`\n${failures === 0 ? '压缩配置验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
