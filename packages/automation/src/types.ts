/** UI Automation 元素（电脑操控的“抓手”）。 */
export interface UiElement {
  /** 控件名（用户能看见的文字）。 */
  name: string
  /** 控件类型，如 Button、Text、Edit。 */
  type: string
  /** 自动化 id（稳定定位用）。 */
  automationId: string
  /** 屏幕坐标。 */
  x: number
  y: number
  width: number
  height: number
  /** 是否可交互。 */
  enabled: boolean
}
