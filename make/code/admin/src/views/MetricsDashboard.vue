<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { MetricsSnapshot } from '@shared/types/metrics'
import { getMetrics } from '../services/api'

const metrics = ref<MetricsSnapshot | null>(null)
const loading = ref(false)

/** 比率展示：null 显示「—」，否则百分比保留 1 位小数 */
function pct(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`
}

/** ISO 时间 → Asia/Shanghai 展示（UTC+8 固定偏移换算，与 miniprogram utils/format 同口径） */
function formatShanghaiMinute(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await getMetrics()
    if (res.code === 0 && res.data) {
      metrics.value = res.data
    } else {
      ElMessage.error(`加载失败：${res.message}`)
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <h2 class="page-title">数据看板（spec 第 6 节验证指标 / M5）</h2>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="KPI 口径唯一定义在 shared/domain/metrics：周活=近 7 天不同 openId；订阅率=可触达订阅者/周活；打开率=提醒打开数/推送成功数；纠错率=纠错动作/发布动作。分母为 0 显示「—」。"
    />

    <div class="toolbar">
      <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
      <span v-if="metrics" class="toolbar-hint">统计时间 {{ formatShanghaiMinute(metrics.computedAt) }}</span>
    </div>

    <div v-if="metrics" class="cards">
      <el-card class="card">
        <div class="card-label">周活（近 7 天）</div>
        <div class="card-value">{{ metrics.weeklyActiveUsers }}</div>
      </el-card>
      <el-card class="card">
        <div class="card-label">总用户</div>
        <div class="card-value">{{ metrics.totalUsers }}</div>
      </el-card>
      <el-card class="card">
        <div class="card-label">可触达订阅者</div>
        <div class="card-value">{{ metrics.reachableSubscribers }}</div>
      </el-card>
      <el-card class="card">
        <div class="card-label">订阅率</div>
        <div class="card-value">{{ pct(metrics.subscribeRate) }}</div>
      </el-card>
      <el-card class="card">
        <div class="card-label">提醒推送成功</div>
        <div class="card-value">{{ metrics.reminderPushed }}</div>
      </el-card>
      <el-card class="card">
        <div class="card-label">提醒打开</div>
        <div class="card-value">{{ metrics.reminderOpens }}</div>
      </el-card>
      <el-card class="card">
        <div class="card-label">打开率</div>
        <div class="card-value">{{ pct(metrics.openRate) }}</div>
      </el-card>
      <el-card class="card">
        <div class="card-label">投稿数（总 / 近 7 天）</div>
        <div class="card-value">{{ metrics.submissionsTotal }} / {{ metrics.submissions7d }}</div>
      </el-card>
      <el-card class="card">
        <div class="card-label">纠错率</div>
        <div class="card-value">{{ pct(metrics.correctionRate) }}</div>
        <div class="card-sub">纠错 {{ metrics.corrections }} 次 / 发布 {{ metrics.publishes }} 次</div>
      </el-card>
    </div>
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

.cards {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.card-label {
  font-size: 13px;
  color: #909399;
}

.card-value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}

.card-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}
</style>
