import { createRouter, createWebHashHistory } from 'vue-router'
import InfoCreate from '../views/InfoCreate.vue'
import ReviewQueue from '../views/ReviewQueue.vue'
import RoadmapManage from '../views/RoadmapManage.vue'
import ImportMonitor from '../views/ImportMonitor.vue'
import MetricsDashboard from '../views/MetricsDashboard.vue'

// hash history：云开发静态托管无需服务端 rewrite 配置
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/create' },
    { path: '/create', name: 'info-create', component: InfoCreate, meta: { title: '信息录入' } },
    { path: '/review', name: 'review-queue', component: ReviewQueue, meta: { title: '审核队列' } },
    { path: '/roadmap', name: 'roadmap-manage', component: RoadmapManage, meta: { title: '路线图维护' } },
    { path: '/import', name: 'import-monitor', component: ImportMonitor, meta: { title: '监控产物导入' } },
    { path: '/metrics', name: 'metrics-dashboard', component: MetricsDashboard, meta: { title: '数据看板' } },
    { path: '/:pathMatch(.*)*', redirect: '/create' }
  ]
})

export default router
