<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { informationCreateSchema } from '@shared/schemas/information'
import type { DeadlineInfo, SourceType } from '@shared/types/common'
import type { InfoCategory, InfoSubType } from '@shared/types/information'
import { CATEGORY_OPTIONS, SOURCE_TYPE_OPTIONS, SUB_TYPE_OPTIONS } from '../labels'
import { createInfo } from '../services/api'

const TZ = 'Asia/Shanghai'

type Precision = 'date' | 'datetime'

interface TimeFieldState {
  precision: Precision
  value: string
}

function emptyTimeField(): TimeFieldState {
  return { precision: 'date', value: '' }
}

const form = reactive({
  title: '',
  category: 'opportunity' as InfoCategory,
  subType: '' as InfoSubType | '',
  summary: '',
  content: '',
  deadline: emptyTimeField(),
  eventTime: emptyTimeField(),
  location: '',
  targetAudience: '',
  sourceUrl: '',
  sourceChannel: '',
  sourceType: 'manual' as SourceType
})

const submitting = ref(false)

/** 精度切换后清空已选值，避免 date/datetime 两种格式串味 */
function onPrecisionChange(field: TimeFieldState): void {
  field.value = ''
}

/** 统一存储 ISO 8601 + 显式时区偏移（AGENT.md §3.3 时间规则） */
function attachOffset(value: string): string {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+08:00`
}

function toDeadlineInfo(state: TimeFieldState): DeadlineInfo | undefined {
  const raw = state.value.trim()
  if (!raw) return undefined
  return {
    date: state.precision === 'date' ? raw.slice(0, 10) : attachOffset(raw),
    precision: state.precision,
    tz: TZ
  }
}

function buildInput(): Record<string, unknown> {
  return {
    title: form.title,
    category: form.category,
    subType: form.subType === '' ? undefined : form.subType,
    summary: form.summary === '' ? undefined : form.summary,
    content: form.content === '' ? undefined : form.content,
    deadline: toDeadlineInfo(form.deadline),
    // 录入端一律不勾人工复核，发布前在审核队列强制复核（AGENT.md §4.3 / R12）
    deadlineVerifiedByHuman: false,
    eventTime: toDeadlineInfo(form.eventTime),
    location: form.location === '' ? undefined : form.location,
    targetAudience: form.targetAudience === '' ? undefined : form.targetAudience,
    sourceUrl: form.sourceUrl,
    sourceChannel: form.sourceChannel,
    sourceType: form.sourceType
  }
}

function resetForm(): void {
  form.title = ''
  form.category = 'opportunity'
  form.subType = ''
  form.summary = ''
  form.content = ''
  form.deadline = emptyTimeField()
  form.eventTime = emptyTimeField()
  form.location = ''
  form.targetAudience = ''
  form.sourceUrl = ''
  form.sourceChannel = ''
  form.sourceType = 'manual'
}

async function handleSubmit(): Promise<void> {
  // AGENT.md §4.2：后台表单写操作必须过 shared 的 zod 校验
  const parsed = informationCreateSchema.safeParse(buildInput())
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || '表单'}：${issue.message}`).join('；')
    ElMessage.error(`校验未通过：${detail}`)
    return
  }

  submitting.value = true
  try {
    const res = await createInfo(parsed.data)
    if (res.code === 0 && res.data) {
      if (res.data.duplicate) {
        ElMessage.warning(`命中去重（contentHash 已存在），返回既有条目 id=${res.data.id}，未重复入库`)
      } else {
        ElMessage.success(`录入成功，已进入待审核（id=${res.data.id}）`)
        resetForm()
      }
    } else {
      ElMessage.error(`录入失败：${res.message}`)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page">
    <h2 class="page-title">信息录入（spec B3）</h2>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="不做无来源信息：来源链接（sourceUrl）与来源渠道（sourceChannel）至少填一项，缺失无法通过校验、也无法发布。"
    />
    <el-alert
      class="mt-12"
      type="warning"
      :closable="false"
      show-icon
      title="截止日期发布前需人工复核：录入时 deadlineVerifiedByHuman 固定为 false，须在审核队列发布时勾选「截止日期已人工复核」才允许发布。"
    />

    <el-form class="mt-16" label-width="150px">
      <el-form-item label="标题 title" required>
        <el-input v-model="form.title" maxlength="200" show-word-limit placeholder="如：第十六届全国大学生数学竞赛报名通知" />
      </el-form-item>

      <el-form-item label="类别 category" required>
        <el-select v-model="form.category" style="width: 220px">
          <el-option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </el-form-item>

      <el-form-item label="子类 subType">
        <el-select v-model="form.subType" style="width: 220px" clearable placeholder="可选">
          <el-option v-for="opt in SUB_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </el-form-item>

      <el-form-item label="摘要 summary">
        <el-input v-model="form.summary" type="textarea" :rows="3" maxlength="500" show-word-limit />
      </el-form-item>

      <el-form-item label="正文 content">
        <el-input v-model="form.content" type="textarea" :rows="6" maxlength="20000" show-word-limit />
      </el-form-item>

      <el-form-item label="截止时间 deadline">
        <div class="time-field">
          <el-radio-group v-model="form.deadline.precision" @change="onPrecisionChange(form.deadline)">
            <el-radio-button value="date">仅日期 date</el-radio-button>
            <el-radio-button value="datetime">含时刻 datetime</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-model="form.deadline.value"
            :type="form.deadline.precision === 'date' ? 'date' : 'datetime'"
            :value-format="form.deadline.precision === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm:ss'"
            placeholder="选择截止时间"
            style="width: 240px"
          />
        </div>
        <div class="field-tip">存储 ISO 8601（+08:00）；date 精度仅存日期，datetime 精度含时刻，发布前须人工复核。</div>
      </el-form-item>

      <el-form-item label="活动时间 eventTime">
        <div class="time-field">
          <el-radio-group v-model="form.eventTime.precision" @change="onPrecisionChange(form.eventTime)">
            <el-radio-button value="date">仅日期 date</el-radio-button>
            <el-radio-button value="datetime">含时刻 datetime</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-model="form.eventTime.value"
            :type="form.eventTime.precision === 'date' ? 'date' : 'datetime'"
            :value-format="form.eventTime.precision === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm:ss'"
            placeholder="选择活动时间"
            style="width: 240px"
          />
        </div>
      </el-form-item>

      <el-form-item label="地点 location">
        <el-input v-model="form.location" maxlength="200" placeholder="如：教三楼 201 / 线上腾讯会议" />
      </el-form-item>

      <el-form-item label="面向对象 audience">
        <el-input v-model="form.targetAudience" maxlength="200" placeholder="如：全校本科生 / 2026 届毕业生" />
      </el-form-item>

      <el-form-item label="来源链接 sourceUrl">
        <el-input v-model="form.sourceUrl" maxlength="1000" placeholder="https://...（与来源渠道至少填一项）" />
      </el-form-item>

      <el-form-item label="来源渠道 sourceChannel">
        <el-input v-model="form.sourceChannel" maxlength="200" placeholder="如：XX 大学教务处 / 公众号名称（与来源链接至少填一项）" />
      </el-form-item>

      <el-form-item label="来源类型 sourceType" required>
        <el-select v-model="form.sourceType" style="width: 220px">
          <el-option v-for="opt in SOURCE_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">提交（zod 校验后入库）</el-button>
        <el-button @click="resetForm">重置</el-button>
      </el-form-item>
    </el-form>
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
  max-width: 860px;
  background: #ffffff;
  padding: 24px 24px 8px;
  border-radius: 4px;
}

.time-field {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.field-tip {
  width: 100%;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
</style>
