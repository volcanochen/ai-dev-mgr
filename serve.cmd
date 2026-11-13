@echo off
rem Gatekeeper 一键本地部署：启动静态服务并自动打开浏览器
rem 依赖：已安装 Node.js（npx 会自动拉取 http-server，无需全局安装）
cd /d "%~dp0"
echo [Gatekeeper] 启动本地服务 http://127.0.0.1:8931/ ...
npx -y http-server gatekeeper -p 8931 -a 127.0.0.1 -c-1 -o
