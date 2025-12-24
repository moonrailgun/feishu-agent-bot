/**
 * Test script for uploading image from URL to Lark
 * 测试脚本：从URL上传图片到飞书并获取image_key
 */

import { larkService } from '../src/service/lark';

async function testUploadImage() {
  try {
    console.log('开始测试图片上传...');
    console.log('Starting image upload test...\n');

    const imageUrl = 'https://image-cdn.flowgpt.com/generated_images/4af07f86-0e43-400e-8ee0-6f4d9c55d444.png';

    console.log(`图片URL: ${imageUrl}`);
    console.log(`Image URL: ${imageUrl}\n`);

    console.log('正在下载并上传图片到飞书...');
    console.log('Downloading and uploading image to Lark...\n');

    const response = await larkService.uploadImageFromUrl(imageUrl, 'message');

    if (response?.image_key) {
      const imageKey = response.image_key;
      console.log('✅ 上传成功！');
      console.log('✅ Upload successful!\n');
      console.log('==========================================');
      console.log(`Image Key: ${imageKey}`);
      console.log('==========================================\n');
      console.log('完整响应数据:');
      console.log('Full response data:');
      console.log(JSON.stringify(response, null, 2));
    } else {
      console.error('❌ 上传失败！');
      console.error('❌ Upload failed!');
      console.error('Response:', response);
    }
  } catch (error) {
    console.error('❌ 发生错误 / Error occurred:');
    console.error(error);
  }
}

testUploadImage();
