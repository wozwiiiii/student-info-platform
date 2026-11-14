export default defineAppConfig({
  pages: [
    'pages/feed/index',
    'pages/category/index',
    'pages/calendar/index',
    'pages/roadmap/index',
    'pages/submit/index'
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '大学生信息中台',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f5f7fa'
  },
  tabBar: {
    color: '#97a2af',
    selectedColor: '#1f6feb',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/feed/index',
        text: '信息流'
      },
      {
        pagePath: 'pages/category/index',
        text: '分类频道'
      },
      {
        pagePath: 'pages/calendar/index',
        text: '日历'
      },
      {
        pagePath: 'pages/roadmap/index',
        text: '路线图'
      },
      {
        pagePath: 'pages/submit/index',
        text: '投稿'
      }
    ]
  }
})
