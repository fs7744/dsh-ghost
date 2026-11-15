; NSIS 自定义脚本（占位骨架）。
; 目标：本地优先，不写云端配置、不创建账号、不上报任何数据。
; 文件关联（.flow / .md）与 dsh-ghost:// 协议由 electron-builder 配置生成，
; 安装器不额外写注册表敏感键。

!macro customHeader
  ; 安装向导头图占位：真实资源为 build/resources/installerHeader.bmp，待补。
!macroend

!macro customInstall
  ; 首启向导（apps/shell/onboarding.html）负责产出本地 settings.json；
  ; 安装阶段不预置任何凭据、token 或 API key。
  ; EULA 文本随安装包另附，声明数据本地存储、无云同步、BYOK 责任划分。
!macroend

!macro customUnInstall
  ; 卸载保留用户数据（settings.json / state / 票 / 剧本），由用户手动清理；
  ; 避免卸载时误删用户工作区。
!macroend
