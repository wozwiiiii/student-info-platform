<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { roadmapNodeCreateSchema, roadmapNodeUpdateSchema } from '@shared/schemas/roadmap'
import { filterStaleNodes, isNodeStale, ROADMAP_STALE_DAYS } from '@shared/domain/roadmap'
import type { RoadmapNode } from '@shared/types/roadmap'
import { CATEGORY_OPTIONS, ROADMAP_SEMESTER_OPTIONS, ROADMAP_YEAR_OPTIONS } from '../labels'
import { createRoadmapNode, listRoadmapNodes, updateRoadmapNode } from '../services/api'

const nodes = ref<RoadmapNode[]>([])
const loading = ref(false)
const onlyStale = ref(false)
const now = new Date()

const shown = computed<RoadmapNode[]>(() =>
  onlyStale.value ? filterStaleNodes(nodes.value, now) : nodes.value
)

function yearLabel(year: number): string {
  return ROADMAP_YEAR_OPTIONS.find((o) => Number(o.value) === year)?.label ?? String(year)
}

function semesterLabel(semester: number): string {
  return ROADMAP_SEMESTER_OPTIONS.find((o) => Number(o.value) === semester)?.label ?? String(semester)
}

function staleCount(): number {
  return filterStaleNodes(nodes.value, now).length
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await listRoadmapNodes()
    if (res.code === 0 && res.data) {
      nodes.value = res.data.items
    } else {
      ElMessage.error(`加载失败：${res.message}`)
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)

/* ---------------- 新建 / 编辑 ---------------- */

interface FormState {
  id: string | null
  year: number
  semester: number
  title: string
  description: string
  typicalWindow: string
  relatedCategory: string
  relatedInfoIdsText: string
  lastMaintainedAt: string
}

function emptyForm(): FormState {
  return {
    id: null,
    year: 1,
    semester: 1,
    title: '',
    description: '',
    typicalWindow: '',
    relatedCategory: '',
    relatedInfoIdsText: '',
    lastMaintainedAt: ''
  }
}

const dialogVisible = ref(false)
const submitting = ref(false)
const form = reactive<FormState>(emptyForm())

function openCreate(): void {
  Object.assign(form, emptyForm())
  dialogVisible.value = true
}

function openEdit(node: RoadmapNode): void {
  Object.assign(form, {
    id: node.id,
    year: node.year,
    semester: node.semester,
    title: node.title,
    description: node.description ?? '',
    typicalWindow: node.typicalWindow ?? '',
    relatedCategory: node.relatedCategory ?? '',
    relatedInfoIdsText: node.relatedInfoIds.join('\n'),
    lastMaintainedAt: node.lastMaintainedAt
  })
  dialogVisible.value = true
}

function buildInput(isEdit: boolean): Record<string, unknown> {
  return {
    year: form.year,
    semester: form.semester,
    title: form.title,
    description: form.description === '' ? undefined : form.description,
    typicalWindow: form.typicalWindow === '' ? undefined : form.typicalWindow,
    relatedCategory: form.relatedCategory === '' ? undefined : form.relatedCategory,
    relatedInfoIds: form.relatedInfoIdsText
      .split(/[\n,，]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    // 编辑不回传 lastMaintainedAt：服务端对内容字段变更会自动刷新为当天（编辑即整理）；
    // 之前恒回传旧值导致「显式传入以传入为准」，自动刷新永不触发
    ...(isEdit ? {} : { lastMaintainedAt: form.lastMaintainedAt })
  }
}

async function handleSubmit(): Promise<void> {
  // AGENT.md §4.2：后台表单写操作必须过 shared 的 zod 校验
  const isEdit = form.id !== null
  const parsed = isEdit
    ? roadmapNodeUpdateSchema.safeParse(buildInput(true))
    : roadmapNodeCreateSchema.safeParse(buildInput(false))
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || '表单'}：${issue.message}`).join('；')
    ElMessage.error(`校验未通过：${detail}`)
    return
  }

  submitting.value = true
  try {
    const res = isEdit
      ? await updateRoadmapNode(form.id as string, parsed.data)
      : await createRoadmapNode(parsed.data as Parameters<typeof createRoadmapNode>[0])
    if (res.code === 0) {
      ElMessage.success(isEdit ? '已更新（编辑视为一次整理，lastMaintainedAt 已自动刷新为当天）' : '节点已创建')
      dialogVisible.value = false
      await load()
    } else {
      ElMessage.error(`保存失败：${res.message}`)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page">
    <h2 class="page-title">路线图维护（spec A4 / R8）</h2>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="R8 防过期：lastMaintainedAt 必填；距最后整理日满 180 天的节点进入「待维护」。编辑内容视为一次整理，会自动刷新整理时间。"
    />

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新建节点</el-button>
      <el-checkbox v-model="onlyStale">只看待维护</el-checkbox>
      <el-tag v-if="staleCount() > 0" type="warning">待维护 {{ staleCount() }} 个</el-tag>
      <span class="toolbar-hint">共 {{ nodes.length }} 个节点</span>
    </div>

    <el-table v-loading="loading" :data="shown" border class="mt-12">
      <el-table-column label="学年" width="80">
        <template #default="{ row }">{{ yearLabel(row.year) }}</template>
      </el-table-column>
      <el-table-column label="学期" width="100">
        <template #default="{ row }">{{ semesterLabel(row.semester) }}</template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="180" />
      <el-table-column prop="typicalWindow" label="典型时间窗" width="140" />
      <el-table-column label="关联类别" width="110">
        <template #default="{ row }">
          {{ CATEGORY_OPTIONS.find((o) => o.value === row.relatedCategory)?.label ?? '—' }}
        </template>
      </el-table-column>
      <el-table-column label="关联信息" width="90">
        <template #default="{ row }">{{ (row.relatedInfoIds ?? []).length }} 条</template>
      </el-table-column>
      <el-table-column label="最后整理" width="150">
        <template #default="{ row }">
          <span>{{ row.lastMaintainedAt }}</span>
          <el-tag v-if="isNodeStale(row, now)" type="danger" size="small" class="ml-8">待维护</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑节点' : '新建节点'" width="640px">
      <el-form label-width="120px">
        <el-form-item label="学年" required>
          <el-select v-model="form.year" style="width: 160px">
            <el-option v-for="opt in ROADMAP_YEAR_OPTIONS" :key="opt.value" :label="opt.label" :value="Number(opt.value)" />
          </el-select>
          <el-select v-model="form.semester" style="width: 160px; margin-left: 12px">
            <el-option v-for="opt in ROADMAP_SEMESTER_OPTIONS" :key="opt.value" :label="opt.label" :value="Number(opt.value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="100" placeholder="如：英语四级报名" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="1000" />
        </el-form-item>
        <el-form-item label="典型时间窗">
          <el-input v-model="form.typicalWindow" maxlength="100" placeholder="如：每年 3 月、9 月（仅展示用）" />
        </el-form-item>
        <el-form-item label="关联类别">
          <el-select v-model="form.relatedCategory" clearable style="width: 200px" placeholder="可选">
            <el-option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联信息 id">
          <el-input
            v-model="form.relatedInfoIdsText"
            type="textarea"
            :rows="3"
            placeholder="每行一个 information 条目 id（可选）"
          />
        </el-form-item>
        <el-form-item v-if="form.id" label="最后整理时间">
          <el-input :model-value="form.lastMaintainedAt" readonly style="width: 200px" />
          <span class="field-tip">编辑视为一次整理，保存后自动更新为当天</span>
        </el-form-item>
        <el-form-item v-else label="最后整理时间" required>
          <el-date-picker v-model="form.lastMaintainedAt" type="date" value-format="YYYY-MM-DD" style="width: 200px" />
          <span class="field-tip">新建时必填（YYYY-MM-DD）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">保存（zod 校验）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 12px;
  font-size: 18px;
  color: #303133;
}

.toolbar {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.toolbar-hint {
  font-size: 12px;
  color: #909399;
}

.mt-12 {
  margin-top: 12px;
}

.ml-8 {
  margin-left: 8px;
}

.field-tip {
  margin-left: 12px;
  font-size: 12px;
  color: #909399;
}
</style>
