import { ENERGY_LABEL, HORIZON_LABEL, type Energy, type Horizon } from '../domain/loop'
import type { ChipOption } from './Chips'

export const HORIZON_OPTIONS: ChipOption<Horizon>[] = (['today', 'week', 'later'] as const).map((h) => ({
  value: h,
  label: HORIZON_LABEL[h],
}))

export const ESTIMATE_OPTIONS: ChipOption<number | null>[] = [
  { value: null, label: 'ไม่ระบุ' },
  { value: 15, label: '15 นาที' },
  { value: 30, label: '30 นาที' },
  { value: 60, label: '1 ชม.' },
  { value: 120, label: '2 ชม.' },
  { value: 240, label: '4 ชม.' },
]

export const ENERGY_OPTIONS: ChipOption<Energy | null>[] = [
  { value: null, label: 'ไม่ระบุ' },
  { value: 'deep', label: ENERGY_LABEL.deep },
  { value: 'shallow', label: ENERGY_LABEL.shallow },
]
