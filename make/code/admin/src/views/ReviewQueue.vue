<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { DeadlineInfo } from '@shared/types/common'
import type { InfoCategory, Information, ReviewStatus } from '@shared/types/information'
import {
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_OPTIONS,
  SOURCE_TYPE_LABELS,
  SUB_TYPE_LABELS
} from '../labels'
import { listAdmin, reviewInfo, type ReviewInput } from '../services/api'

interface PublishTarget {
  id: string
  title: string
  deadline?: DeadlineInfo
}

const filters = reactive({
  status: '' as ReviewStatus | '',
  category: '' as InfoCategory | ''
})
const items = ref<Information[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

const publishVisible = ref(false)
const publishTarget = ref<PublishTarget | null>(null)
const deadlineChecked = ref(false)
const actionLoading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await listAdmin({
      status: filters.status,
      category: filters.category,
      page: page.value,
      pageSize: pageSize.value
    })
    if (res.code === 0 && res.data) {
      items.value = res.data.items
      total.value = res.data.total
    } else {
      items.value = []
      total.value = 0
      ElMessage.error(`加载审核队列失败：${res.message}`)
    }
  } finally {
    loading.value = false
  }
}

function onFilterChange(): void {
  page.value = 1
  void load()
}

function onSizeChange(): void {
  page.value = 1
  void load()
}

function statusLabel(status: ReviewStatus): string {
  return REVIEW_STATUS_LABELS[status]
}

function statusTagType(status: ReviewStatus): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  if (status === 'published') return 'success'
  if (status === 'low_confidence' || status === 'rejected') return 'danger'
  if (status === 'pending_review') return 'warning'
  if (status === 'expired' || status === 'archived') return 'info'
  return 'primary'
}

function categoryLabel(category: InfoCategory): string {
  return CATEGORY_LABELS[category]
}

function subTypeLabel(subType: Information['subType']): string {
  return subType ? SUB_TYPE_LABELS[subType] : ''
}

function sourceTypeLabel(sourceType: Information['sourceType']): string {
  return SOURCE_TYPE_LABELS[sourceType]
}

/** 展示层格式化：deadline 是第一公民，明确标注 date/datetime 精度 */
function formatDeadline(deadline: DeadlineInfo | undefined): string {
  if (!deadline) return '—'
  return deadline.precision === 'date' ? `${deadline.date.slice(0, 10)}（仅日期）` : deadline.date.replace('T', ' ')
}

function openPublish(row: Information): void {
  publishTarget.value = { id: row.id, title: row.title, deadline: row.deadline }
  deadlineChecked.value = false
  publishVisible.value = true
}

async function doReview(input: ReviewInput): Promise<void> {
  actionLoading.value = true
  try {
    const res = await reviewInfo(input)
    if (res.code === 0) {
      ElMessage.success(`操作成功（${res.message}）`)
      await load()
    } else {
      ElMessage.error(`操作失败：${res.message}`)
    }
  } finally {
    actionLoading.value = false
  }
}

async function confirmPublish(): Promise<void> {
  const target = publishTarget.value
  if (!target) return
  if (target.deadline && !deadlineChecked.value) {
    ElMessage.warning('请先勾选「截止日期已人工复核」')
    return
  }
  publishVisible.value = false
  // 有 deadline 的条目：勾选后才允许 deadlineVerifiedByHuman=true；无 deadline 条目免勾（不覆盖既有值）
  await doReview(
    target.deadline
      ? { id: target.id, action: 'publish', deadlineVerifiedByHuman: true }
      : { id: target.id, action: 'publish' }
  )
}

function handleReject(row: Information): void {
  void ElMessageBox.confirm(`确认驳回「${row.title}」？驳回后进入 rejected 状态并留痕。`, '驳回确认', { type: 'warning' })
    .then(() => doReview({ id: row.id, action: 'reject' }))
    .catch(() => undefined)
}

function handleCorrect(row: Information): void {
  void ElMessageBox.confirm(`确认对「${row.title}」发起纠错？纠错后进入 corrected 状态并在 review_log 留痕。`, '纠错确认', {
    type: 'warning'
  })
    .then(() => doReview({ id: row.id, action: 'correct' }))
    .catch(() => undefined)
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page">
    <h2 class="page-title">审核队列（审核机制）</h2>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="发布门禁：来源缺失禁止发布；带截止日期的条目必须勾选「截止日期已人工复核」（deadlineVerifiedByHuman=true）才可发布（R12）。"
    />

    <div class="filter-bar">
      <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 200px" @change="onFilterChange">
        <el-option v-for="opt in REVIEW_STATUS_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
      <el-select v-model="filters.category" placeholder="全部类别" clearable style="width: 180px" @change="onFilterChange">
        <el-option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="items" border stripe>
      <el-table-column label="状态" width="150">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.reviewStatus)">{{ statusLabel(scope.row.reviewStatus) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="240" show-overflow-tooltip />
      <el-table-column label="类别" width="150">
        <template #default="scope">
          {{ categoryLabel(scope.row.category) }}{{ scope.row.subType ? ` · ${subTypeLabel(scope.row.subType)}` : '' }}
        </template>
      </el-table-column>
      <el-table-column label="来源" width="260">
        <template #default="scope">
          <div>{{ scope.row.sourceChannel || '—' }}（{{ sourceTypeLabel(scope.row.sourceType) }}）</div>
          <el-link v-if="scope.row.sourceUrl" :href="scope.row.sourceUrl" target="_blank" type="primary">
            {{ scope.row.sourceUrl }}
          </el-link>
        </template>
      </el-table-column>
      <el-table-column label="截止时间" width="180">
        <template #default="scope">
          {{ formatDeadline(scope.row.deadline) }}
          <el-tag v-if="scope.row.deadline && scope.row.deadlineVerifiedByHuman" size="small" type="success">已复核</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="scope">
          <el-button type="primary" link @click="openPublish(scope.row)">发布</el-button>
          <el-button type="danger" link @click="handleReject(scope.row)">驳回</el-button>
          <el-button type="warning" link @click="handleCorrect(scope.row)">纠错</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="load"
        @size-change="onSizeChange"
      />
    </div>

    <el-dialog v-model="publishVisible" title="发布确认" width="480px">
      <p class="dialog-line">条目：{{ publishTarget?.title }}</p>
      <p class="dialog-line">截止时间：{{ formatDeadline(publishTarget?.deadline) }}</p>
      <template v-if="publishTarget?.deadline">
        <el-checkbox v-model="deadlineChecked">截止日期已人工复核（deadlineVerifiedByHuman=true）</el-checkbox>
        <el-alert
          v-if="!deadlineChecked"
          class="mt-8"
          type="warning"
          :closable="false"
          title="勾选「截止日期已人工复核」后才允许发布（AGENT.md §4.3 / R12）。"
        />
      </template>
      <el-alert v-else type="info" :closable="false" title="该条目无截止日期，免勾选人工复核。" />
      <template #footer>
        <el-button @click="publishVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="Boolean(publishTarget?.deadline) && !deadlineChecked"
          :loading="actionLoading"
          @click="confirmPublish"
        >
          确认发布
        </el-button>
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

.filter-bar {
  margin: 12px 0;
  display: flex;
  gap: 12px;
  align-items: center;
}

.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.dialog-line {
  margin: 0 0 8px;
  color: #303133;
}

.mt-8 {
  margin-top: 8px;
}
</style>
