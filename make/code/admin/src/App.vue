<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="220px" class="app-aside">
      <div class="app-logo">大学生信息数据中台</div>
      <div class="app-sub">录入 / 审核工作台</div>
      <el-menu :default-active="route.path" router class="app-menu">
        <el-menu-item index="/create">信息录入（B3）</el-menu-item>
        <el-menu-item index="/review">审核队列</el-menu-item>
        <el-menu-item index="/roadmap">路线图维护（A4）</el-menu-item>
        <el-menu-item index="/import">监控产物导入（B1）</el-menu-item>
        <el-menu-item index="/metrics">数据看板（M5）</el-menu-item>
      </el-menu>
    </el-aside>
    <el-main class="app-main">
      <router-view />
    </el-main>
  </el-container>
</template>

<style>
html,
body {
  margin: 0;
  padding: 0;
  background: #f5f7fa;
  font-family: 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

#app {
  min-height: 100vh;
}
</style>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.app-aside {
  background: #ffffff;
  border-right: 1px solid #e4e7ed;
  padding: 16px 0;
}

.app-logo {
  padding: 0 20px;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.app-sub {
  padding: 4px 20px 12px;
  font-size: 12px;
  color: #909399;
}

.app-menu {
  border-right: none;
}

.app-main {
  padding: 20px;
}
</style>
