import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
    },
    {
      path: '/scan',
      name: 'scanner',
      component: () => import('@/views/ScannerView.vue'),
    },
    {
      path: '/maker',
      name: 'maker',
      component: () => import('@/views/ExamMakerView.vue'),
    },
    {
      path: '/exams',
      name: 'exams',
      component: () => import('@/views/ExamBankView.vue'),
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@/views/ScoreHistoryView.vue'),
    },
    {
      path: '/review/:id',
      name: 'review',
      component: () => import('@/views/ReviewAnswerView.vue'),
      props: true,
    },
    {
      path: '/review-answer/:id',
      name: 'review-answer',
      component: () => import('@/views/ReviewAnswerView.vue'),
      props: true,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});
