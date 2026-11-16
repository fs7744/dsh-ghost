/**
 * 模型管理独立页入口（C3-01/02/03/05）。
 * host 逻辑在 models-host.ts，与设置页「模型」分类共用。
 */
import { mountModelsPanel } from './models-panel.ts'
import { createModelsHost } from './models-host.ts'

const root = document.getElementById('models-root')
if (root !== null) mountModelsPanel(root, createModelsHost())
