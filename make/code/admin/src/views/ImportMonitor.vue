<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { informationCreateSchema } from '@shared/schemas/information'
import type { InformationCreateInput } from '@shared/schemas/information'
import type { SourceType } from '@shared/types/common'
import type { InfoCategory, InfoSubType } from '@shared/types/information'
import { CATEGORY_OPTIONS, SOURCE_TYPE_LABELS, SUB_TYPE_OPTIONS } from '../labels'
import { importInfos, type ImportResultData } from '../services/api'

/** 监控产物条目（tools/mp-monitor 产物结构，category/subType 由人工在导入时确认） */
interface ArtifactRow {
  include: boolean
  title: string
  sourceUrl: string
  sourceChannel: string
  sourceType: string
  summary: string
  content: string
  category: InfoCategory | ''
  subType: InfoSubType | ''
}

const rows = ref<ArtifactRow[]>([])
const fileName = ref('')
const importing = ref(false)
const result = ref<ImportResultData | null>(null)

function toRow(raw: Record<string, unknown>): ArtifactRow {
  return {
    include: true,
    title: String(raw.title ?? ''),
    sourceUrl: String(raw.sourceUrl ?? ''),
    sourceChannel: String(raw.sourceChannel ?? ''),
    sourceType: String(raw.sourceType ?? 'manual'),
    summary: String(raw.summary ?? ''),
    content: String(raw.content ?? ''),
    category: '',
    subType: ''
  }
}

async function onFileChange(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  result.value = null
  try {
    const text = await file.text()
    const parsed: unknown = JSON.parse(text)
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null
    if (!items) {
      ElMessage.error('产物结构不符：需要 { schemaVersion, items: [...] } 或数组')
      rows.value = []
      return
    }
    rows.value = items.map((it) => toRow((it ?? {}) as Record<string, unknown>))
    ElMessage.success(`已读取 ${rows.value.length} 条，请逐条确认类别后导入`)
  } catch (e) {
    rows.value = []
    ElMessage.error(`解析失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    input.value = ''
  }
}

function buildInput(row: ArtifactRow): Record<string, unknown> {
  return {
    title: row.title,
    category: row.category,
    subType: row.subType === '' ? undefined : row.subType,
    summary: row.summary === '' ? undefined : row.summary,
    content: row.content === '' ? undefined : row.content,
    sourceUrl: row.sourceUrl,
    sourceChannel: row.sourceChannel,
    sourceType: row.sourceType as SourceType
  }
}

async function handleImport(): Promise<void> {
  const included = rows.value.filter((r) => r.include)
  if (included.length === 0) {
    ElMessage.warning('没有勾选任何条目')
    return
  }

  // AGENT.md §4.2：写操作必须过 shared 的 zod 校验（导入前逐条校验，提示原因）
  const valid: InformationCreateInput[] = []
  const problems: string[] = []
  included.forEach((row, i) => {
    const parsed = informationCreateSchema.safeParse(buildInput(row))
    if (parsed.success) {
      valid.push(parsed.data)
    } else {
      problems.push(`第 ${i + 1} 条「${row.title || '无标题'}」：${parsed.error.issues[0]?.message ?? '校验失败'}`)
    }
  })
  if (problems.length > 0) {
    ElMessage.error(problems.join('；'))
    return
  }

  importing.value = true
  try {
    const res = await importInfos(valid)
    if (res.code === 0 && res.data) {
      result.value = res.data
      ElMessage.success(`导入完成：新增 ${res.data.imported} 条，去重跳过 ${res.data.duplicates} 条`)
    } else {
      ElMessage.error(`导入失败：${res.message}`)
    }
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="page">
    <h2 class="page-title">监控产物导入（spec B1，一键导入）</h2>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="导入 tools/mp-monitor 产出的 monitor-*.json：每条先人工确认类别，再批量进入待审核队列（contentHash 自动去重，重复条目跳过）。"
    />
    <el-alert
      class="mt-12"
      type="warning"
      :closable="false"
      show-icon
      title="导入条目强制 deadlineVerifiedByHuman=false：发布前仍须在审核队列人工复核截止日期（AGENT.md §4.3 / R12）。"
    />

    <div class="toolbar">
      <label class="file-label">
        选择产物 JSON
        <input type="file" accept=".json,application/json" @change="onFileChange" />
      </label>
      <span class="toolbar-hint">{{ fileName || '未选择文件' }}</span>
    </div>

    <el-table v-if="rows.length > 0" :data="rows" border class="mt-12">
      <el-table-column label="导入" width="60">
        <template #default="{ row }">
          <el-checkbox v-model="row.include" />
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
      <el-table-column prop="sourceChannel" label="来源渠道" width="130" show-overflow-tooltip />
      <el-table-column prop="sourceUrl" label="原文链接" min-width="180" show-overflow-tooltip />
      <el-table-column label="来源类型" width="90">
        <template #default="{ row }">
          {{ SOURCE_TYPE_LABELS[row.sourceType as SourceType] ?? row.sourceType }}
        </template>
      </el-table-column>
      <el-table-column label="类别（必选）" width="140">
        <template #default="{ row }">
          <el-select v-model="row.category" placeholder="确认类别" style="width: 120px">
            <el-option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="子类（可选）" width="130">
        <template #default="{ row }">
          <el-select v-model="row.subType" clearable placeholder="可选" style="width: 110px">
            <el-option v-for="opt in SUB_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="rows.length > 0" class="toolbar mt-16">
      <el-button type="primary" :loading="importing" @click="handleImport">
        导入勾选条目（{{ rows.filter((r) => r.include).length }} 条）
      </el-button>
    </div>

    <el-alert
      v-if="result"
      class="mt-16"
      type="success"
      :closable="false"
      show-icon
      :title="`导入结果：新增 ${result.imported} 条 / 去重跳过 ${result.duplicates} 条 / 校验失败 ${result.invalid.length} 条`"
    />
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 12px;
  font-size: 18px;
  color: #303133;
}

.mt-12 {
  margin-top: 12px;
}

.mt-16 {
  margin-top: 16px;
}

.toolbar {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.file-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #1f6feb;
  color: #ffffff;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
}

.file-label input {
  display: none;
}

.toolbar-hint {
  font-size: 12px;
  color: #909399;
}
</style>
