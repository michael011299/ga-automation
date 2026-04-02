module.exports = {
  apps: [
    {
      name: 'ga-runner',
      script: 'runners.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,

        // Supabase
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',

        // Monday.com
        MONDAY_API_KEY: process.env.MONDAY_API_KEY || '',
        MONDAY_BOARD_ID_LSEO: process.env.MONDAY_BOARD_ID_LSEO || '1242223716',
        MONDAY_BOARD_ID_TRIALS: process.env.MONDAY_BOARD_ID_TRIALS || '5088296844',
        MONDAY_GROUP_ID: process.env.MONDAY_GROUP_ID || '1690115520_call360_telephony_s',
        MONDAY_COL_ORDER_NUMBER: process.env.MONDAY_COL_ORDER_NUMBER || 'text50',
        MONDAY_COL_CID: process.env.MONDAY_COL_CID || 'cid',
        MONDAY_COL_WEBSITE_URL: process.env.MONDAY_COL_WEBSITE_URL || 'short_text7',
        MONDAY_COL_CMS_CREDS: process.env.MONDAY_COL_CMS_CREDS || 'long_text4',
        MONDAY_COL_NOTES: process.env.MONDAY_COL_NOTES || 'text_mm1myf7x',
        MONDAY_COL_STATUS: process.env.MONDAY_COL_STATUS || 'status70',
        MONDAY_COL_INFO_REASON_LSEO: process.env.MONDAY_COL_INFO_REASON_LSEO || 'color_mm1gsawq',
        MONDAY_COL_INFO_REASON_TRIALS: process.env.MONDAY_COL_INFO_REASON_TRIALS || 'color_mm1g7w89',

        // Google OAuth2 (shared client app)
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

        // Google Ads (shared across all 12 accounts)
        GOOGLE_ADS_REFRESH_TOKEN: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
        GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '4DkVyyBUvjMbEDOgbE9QBQ',
        GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '7651196543',
      },
      max_memory_restart: '1G',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'ga-health',
      script: 'server.js',
      env: { NODE_ENV: 'production', PORT: 3001 },
      max_memory_restart: '1G',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'ga-gateway',
      script: 'gateway.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '256M',
      restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
