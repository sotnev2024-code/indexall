/**
 * Таксономия классов оборудования для распознавания.
 *
 * Источник правды — XML-конфиг разметки Label Studio Максима (клиентский
 * датасет YOLO). Конфиг живой: он дополняет его по мере появления нового
 * оборудования, поэтому классы НЕ захардкожены — актуальный XML хранится в
 * настройке `recognition_ls_config` (админ вставляет через интерфейс),
 * а зашитый ниже DEFAULT_LS_CONFIG — стартовое значение.
 *
 * Помимо классов Label Studio есть СИСТЕМНЫЕ классы (кабель, приёмник…):
 * они нужны листу спецификации, но в датасет YOLO не выгружаются.
 */

export interface RecognitionClass {
  /** внутренний код (slug латиницей) — хранится в recognition_elements.klass */
  code: string;
  /** полное значение метки в Label Studio, напр. "MCB — модульный автомат" */
  lsValue: string;
  /** русское название для интерфейса */
  nameRu: string;
  /** номер категории YOLO из конфига (для экспорта) */
  category: number | null;
  /** цвет рамки */
  color: string;
  /** системный класс — не входит в датасет Label Studio/YOLO */
  system?: boolean;
}

export interface SchemaType {
  value: string;
  nameRu: string;
}

export interface ClassConfig {
  classes: RecognitionClass[];
  schemaTypes: SchemaType[];
}

/** Служебные классы ИНДЕКСАЛЛ — нужны для листа спецификации. */
export const SYSTEM_CLASSES: RecognitionClass[] = [
  { code: 'cable', lsValue: '', nameRu: 'Кабель / провод', category: null, color: '#1d4ed8', system: true },
  { code: 'load', lsValue: '', nameRu: 'Электроприёмник', category: null, color: '#be185d', system: true },
  { code: 'panel', lsValue: '', nameRu: 'Щит / распредпункт', category: null, color: '#334155', system: true },
  { code: 'busbar', lsValue: '', nameRu: 'Шина', category: null, color: '#52616f', system: true },
  { code: 'other', lsValue: '', nameRu: 'Прочее', category: null, color: '#64748b', system: true },
];

/** Старые коды из первой версии модуля → актуальные коды конфига Максима. */
export const LEGACY_ALIASES: Record<string, string> = {
  rcd: 'rccb',
  meter: 'electricity_meter',
};

/** slug из английской части метки: "Fused terminal — клемма..." → fused_terminal */
export function slugFromLsValue(lsValue: string): string {
  const en = lsValue.split('—')[0].trim();
  return en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'other';
}

/** Разбирает XML-конфиг Label Studio (без XML-библиотек — по атрибутам). */
export function parseLsConfig(xml: string): ClassConfig {
  const classes: RecognitionClass[] = [];
  const schemaTypes: SchemaType[] = [];

  const labelRe = /<Label\s+([^>]*?)\/>/gs;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(xml))) {
    const attrs = m[1];
    const value = /value="([^"]*)"/.exec(attrs)?.[1];
    if (!value) continue;
    const category = /category="(\d+)"/.exec(attrs)?.[1];
    const background = /background="([^"]*)"/.exec(attrs)?.[1];
    const ru = value.includes('—') ? value.split('—').slice(1).join('—').trim() : value;
    classes.push({
      code: slugFromLsValue(value),
      lsValue: value,
      nameRu: ru,
      category: category != null ? parseInt(category, 10) : null,
      color: background || '#64748b',
    });
  }

  const choiceRe = /<Choice\s+([^>]*?)\/>/gs;
  while ((m = choiceRe.exec(xml))) {
    const attrs = m[1];
    const value = /value="([^"]*)"/.exec(attrs)?.[1];
    if (!value) continue;
    const alias = /alias="([^"]*)"/.exec(attrs)?.[1];
    schemaTypes.push({ value, nameRu: alias || value });
  }

  return { classes, schemaTypes };
}

/** Полный список классов: из конфига LS + системные (без дублей по коду). */
export function mergeWithSystem(parsed: ClassConfig): ClassConfig {
  const seen = new Set(parsed.classes.map((c) => c.code));
  return {
    classes: [...parsed.classes, ...SYSTEM_CLASSES.filter((c) => !seen.has(c.code))],
    schemaTypes: parsed.schemaTypes.length
      ? parsed.schemaTypes
      : [
          { value: 'single_line', nameRu: 'Однолинейная схема' },
          { value: 'schematic', nameRu: 'Принципиальная схема' },
          { value: 'wiring', nameRu: 'Монтажная схема' },
        ],
  };
}

/** Конфиг Максима от 16.07.2026 — стартовое значение настройки. */
export const DEFAULT_LS_CONFIG = `<View>
  <Image name="image" value="$image"/>

  <Header value="Тип схемы"/>
  <Choices name="schema_type" toName="image" choice="single" required="true" showInline="true">
    <Choice value="single_line" alias="Однолинейная схема"/>
    <Choice value="schematic" alias="Принципиальная схема"/>
    <Choice value="wiring" alias="Монтажная схема"/>
  </Choices>

  <RectangleLabels name="label" toName="image">
<Label value="MCB — модульный автомат" category="0" background="#E74C3C"/>
<Label value="MCCB — автомат в литом корпусе" category="1" background="#D35400"/>
<Label value="RCBO — дифавтомат" category="2" background="#F39C12"/>
<Label value="RCCB — УЗО" category="3" background="#F1C40F"/>
<Label value="ACB — воздушный автомат" category="4" background="#2ECC71"/>
<Label value="LBS — выключатель нагрузки" category="5" background="#1ABC9C"/>
<Label value="CT — трансформатор тока" category="6" background="#3498DB"/>
<Label value="Disconnector — рубильник" category="7" background="#5B6EE1"/>
<Label value="Relay — реле" category="8" background="#9B59B6"/>
<Label value="Contactor — контактор" category="9" background="#E84393"/>
<Label value="Terminal — клемма" category="10" background="#7F8C8D"/>
<Label value="Fused terminal — клемма с предохранителем"
       category="34" background="#F7DC6F"/>
<Label value="Button — кнопка" category="11" background="#16A085"/>
<Label value="Lamp — лампа" category="12" background="#F4D03F"/>
<Label value="Resistor — сопротивление" category="13" background="#AF7AC5"/>
<Label value="Controller — контроллер" category="14" background="#2E86C1"/>
<Label value="Fuse — предохранитель" category="15" background="#CA6F1E"/>
<Label value="Power supply — блок питания" category="16" background="#7DCEA0"/>
<Label value="ATS — АВР" category="17" background="#E59866"/>
<Label value="Ammeter — амперметр" category="18" background="#85C1E9"/>
<Label value="Voltmeter — вольтметр" category="19" background="#BB8FCE"/>
<Label value="Multimeter — мультиметр" category="20" background="#AAB7B8"/>
    <Label value="Switch — переключатель" category="21" background="#48C9B0"/>
<Label value="Contactor coil — катушка контактора" category="22" background="#5DADE2"/>
<Label value="Contactor contact — контакт контактора" category="23" background="#F5B041"/>
<Label value="Relay contact — контакт реле" category="24" background="#EC7063"/>
    <Label value="Pushbutton NO momentary — замыкающая кнопка без фиксации"
       category="25" background="#58D68D"/>
<Label value="Pushbutton NC momentary — размыкающая кнопка без фиксации"
       category="26" background="#F5B7B1"/>
<Label value="Pushbutton NO latching — замыкающая кнопка с фиксацией"
       category="27" background="#5DADE2"/>
<Label value="Pushbutton NC latching — размыкающая кнопка с фиксацией"
       category="28" background="#AF7AC5"/>
    <Label value="Electricity meter — счётчик" category="29" background="#73C6B6"/>
    <Label value="Fuse link — плавкая вставка" category="30" background="#F0B27A"/>
  <Label value="SPD — УЗИП" category="31" background="#85C1E9"/>
  <Label value="AFDD — УЗДП" category="32" background="#A9DFBF"/>
  <Label value="Fuse switch disconnector — Разъединитель-предохранитель"
       category="33" background="#D2B4DE"/>
  </RectangleLabels>
</View>`;
