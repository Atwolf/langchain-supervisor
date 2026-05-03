import { useMemo, useState } from "react"

const fallbackModel = {
    system: {
        name: "",
        description: "",
        users: [],
        entry_points: [],
        edge_layers: [],
    },
    containers: [],
    data_stores: [],
    messaging: [],
    external_systems: [],
}

const clone = (value) => {
    if (value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

const isPlainObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)

const pathParts = (path) =>
    Array.isArray(path) ? path : String(path || "").split(".").filter(Boolean)

const getValue = (model, path, fallback = undefined) => {
    const parts = pathParts(path)
    let current = model

    for (const part of parts) {
        if (current === null || current === undefined) return fallback
        current = current[part]
    }

    return current === undefined ? fallback : current
}

const setValue = (model, path, value) => {
    const parts = pathParts(path)
    if (!parts.length) return value

    const next = clone(model || {})
    let current = next

    parts.slice(0, -1).forEach((part, index) => {
        if (!isPlainObject(current[part]) && !Array.isArray(current[part])) {
            const nextPart = parts[index + 1]
            current[part] = /^\d+$/.test(nextPart) ? [] : {}
        }
        current = current[part]
    })

    current[parts[parts.length - 1]] = value
    return next
}

const mergeTemplate = (template, value) => {
    if (Array.isArray(template)) {
        return Array.isArray(value) ? clone(value) : clone(template)
    }

    if (isPlainObject(template)) {
        const source = isPlainObject(value) ? value : {}
        const next = {}

        Object.keys(template).forEach((key) => {
            next[key] = mergeTemplate(template[key], source[key])
        })
        Object.keys(source).forEach((key) => {
            if (!(key in next)) next[key] = clone(source[key])
        })

        return next
    }

    return value === undefined || value === null ? template : value
}

const unique = (values) => {
    const list = Array.isArray(values) ? values : values === undefined ? [] : [values]
    const seen = new Set()

    return list.filter((value) => {
        const text = String(value || "").trim()
        if (!text || seen.has(text)) return false
        seen.add(text)
        return true
    })
}

const isPresent = (value) => String(value || "").trim().length > 0
const hasSelection = (values) => unique(values).length > 0
const hasBoolean = (value) => value === true || value === false

const slugify = (value, prefix) => {
    const slug = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    return slug ? `${prefix}_${slug}` : prefix
}

const uniqueId = (baseId, seenIds, index) => {
    let itemId = baseId
    if (seenIds.has(itemId)) {
        itemId = `${baseId}_${index}`
    }
    while (seenIds.has(itemId)) {
        index += 1
        itemId = `${baseId}_${index}`
    }
    seenIds.add(itemId)
    return itemId
}

const idForItem = (item, idStrategy, seenIds, index) => {
    const sourcePath = idStrategy?.sourcePath || "name"
    const prefix = idStrategy?.prefix || "item"
    const sourceValue = getValue(item, sourcePath, "")
    return uniqueId(slugify(sourceValue, prefix), seenIds, index)
}

const normalizeOptions = (values) =>
    (values || []).map((option) =>
        isPlainObject(option)
            ? option
            : {
                  value: option,
                  label: option,
              },
    )

const getRepeatSteps = (definition) =>
    (definition?.stages || []).flatMap((stage) =>
        (stage.steps || []).filter((step) => step.type === "repeat"),
    )

const findRepeatStep = (definition, path) =>
    getRepeatSteps(definition).find((step) => step.path === path)

const resolveOptions = (step, model, options, definition) => {
    if (step.options) return normalizeOptions(step.options)
    if (step.optionsKey) return normalizeOptions(options?.[step.optionsKey] || [])

    const source = step.optionsSource
    if (source?.type !== "modelCollection") return []

    const collection = getValue(model, source.path, [])
    const sourceRepeat = findRepeatStep(definition, source.path)
    const seenIds = new Set()

    return (collection || []).reduce((resolved, item, index) => {
        const label = getValue(item, source.labelPath || "name", "")
        if (!isPresent(label)) return resolved

        let value = getValue(item, source.valuePath || "id")
        if ((source.valuePath || "id") === "id" && sourceRepeat?.idStrategy) {
            value = idForItem(item, sourceRepeat.idStrategy, seenIds, index + 1)
        } else if (value) {
            seenIds.add(value)
        }

        if (value) resolved.push({ value, label })
        return resolved
    }, [])
}

const hydrateModel = (model, definition) => {
    const template = definition?.modelTemplate || fallbackModel
    let next = mergeTemplate(template, model || {})

    getRepeatSteps(definition).forEach((step) => {
        const items = getValue(next, step.path, [])
        const hydratedItems = (items || []).map((item) => ({
            ...(step.itemTemplate || {}),
            ...(item || {}),
        }))
        next = setValue(next, step.path, hydratedItems)
    })

    return next
}

const normalizeRootStep = (model, step) => {
    if (step.type === "multiselect") {
        return setValue(model, step.path, unique(getValue(model, step.path, [])))
    }
    return model
}

const normalizeRepeatStep = (model, step) => {
    const seenIds = new Set()
    const items = getValue(model, step.path, [])
    const normalizedItems = (items || []).reduce((normalized, item, index) => {
        if (step.idStrategy && !isPresent(getValue(item, step.idStrategy.sourcePath))) {
            return normalized
        }

        let normalizedItem = {
            ...(step.itemTemplate || {}),
            ...(item || {}),
        }

        if (step.idStrategy) {
            normalizedItem.id = idForItem(
                normalizedItem,
                step.idStrategy,
                seenIds,
                index + 1,
            )
        }

        ;(step.itemSteps || []).forEach((itemStep) => {
            if (itemStep.type === "multiselect") {
                normalizedItem = setValue(
                    normalizedItem,
                    itemStep.path,
                    unique(getValue(normalizedItem, itemStep.path, [])),
                )
            }
            if (itemStep.type === "boolean") {
                normalizedItem = setValue(
                    normalizedItem,
                    itemStep.path,
                    Boolean(getValue(normalizedItem, itemStep.path)),
                )
            }
        })

        normalized.push(normalizedItem)
        return normalized
    }, [])

    return setValue(model, step.path, normalizedItems)
}

const filterModelCollectionRefs = (model, definition, options) => {
    let next = model

    getRepeatSteps(definition).forEach((repeatStep) => {
        const itemSteps = repeatStep.itemSteps || []
        const refSteps = itemSteps.filter(
            (step) =>
                step.type === "multiselect" &&
                step.allowOther === false &&
                step.optionsSource?.type === "modelCollection",
        )
        if (!refSteps.length) return

        const items = getValue(next, repeatStep.path, [])
        const nextItems = (items || []).map((item) => {
            let nextItem = item

            refSteps.forEach((refStep) => {
                const validValues = new Set(
                    resolveOptions(refStep, next, options, definition).map(
                        (option) => option.value,
                    ),
                )
                nextItem = setValue(
                    nextItem,
                    refStep.path,
                    unique(getValue(nextItem, refStep.path, [])).filter((value) =>
                        validValues.has(value),
                    ),
                )
            })

            return nextItem
        })

        next = setValue(next, repeatStep.path, nextItems)
    })

    return next
}

const normalizeDraftForPreview = (model, definition, options) => {
    let next = hydrateModel(model, definition)

    ;(definition?.stages || []).forEach((stage) => {
        ;(stage.steps || []).forEach((step) => {
            if (step.type === "repeat") {
                next = normalizeRepeatStep(next, step)
            } else {
                next = normalizeRootStep(next, step)
            }
        })
    })

    return filterModelCollectionRefs(next, definition, options)
}

const requiredBadge = (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        Required
    </span>
)

const Field = ({ label, children, required = false }) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
        <span className="flex items-center gap-2">
            {label}
            {required && requiredBadge}
        </span>
        {children}
    </label>
)

const TextField = ({ step, value, onChange }) => (
    <Field label={step.label} required={step.required}>
        <input
            value={value || ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder={step.placeholder || ""}
            required={step.required}
            aria-required={step.required}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal outline-none focus:ring-1 focus:ring-primary"
        />
    </Field>
)

const TextAreaField = ({ step, value, onChange }) => (
    <Field label={step.label} required={step.required}>
        <textarea
            value={value || ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder={step.placeholder || ""}
            rows={4}
            required={step.required}
            aria-required={step.required}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal outline-none focus:ring-1 focus:ring-primary"
        />
    </Field>
)

const MultiSelectField = ({
    step,
    value,
    onChange,
    model,
    options,
    definition,
}) => {
    const [other, setOther] = useState("")
    const selected = Array.isArray(value) ? value : []
    const resolvedOptions = resolveOptions(step, model, options, definition)
    const allowOther = step.allowOther !== false
    const labelFor = (selectedValue) => {
        const option = resolvedOptions.find((item) => item.value === selectedValue)
        return option?.label || selectedValue
    }

    const toggle = (selectedValue) => {
        if (selected.includes(selectedValue)) {
            onChange(selected.filter((item) => item !== selectedValue))
        } else {
            onChange([...selected, selectedValue])
        }
    }

    const addOther = () => {
        const otherValue = other.trim()
        if (!otherValue) return
        onChange(unique([...selected, otherValue]))
        setOther("")
    }

    return (
        <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                {step.label}
                {step.required && requiredBadge}
            </span>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {resolvedOptions.map((option) => (
                    <label
                        key={option.value}
                        className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs font-normal"
                    >
                        <input
                            type="checkbox"
                            checked={selected.includes(option.value)}
                            onChange={() => toggle(option.value)}
                        />
                        <span>{option.label}</span>
                    </label>
                ))}
            </div>
            {allowOther && (
                <div className="flex gap-1">
                    <input
                        value={other}
                        onChange={(event) => setOther(event.target.value)}
                        placeholder="Other"
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                        type="button"
                        onClick={addOther}
                        className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted"
                    >
                        Add
                    </button>
                </div>
            )}
            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {selected.map((selectedValue) => (
                        <button
                            type="button"
                            key={selectedValue}
                            onClick={() => toggle(selectedValue)}
                            className="rounded-full bg-muted px-2 py-0.5 text-xs"
                        >
                            {labelFor(selectedValue)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

const BooleanField = ({ step, value, onChange, fieldKey }) => (
    <fieldset className="flex flex-col gap-2 text-xs font-medium">
        <legend className="flex items-center gap-2">
            {step.label}
            {step.required && requiredBadge}
        </legend>
        <div className="flex gap-3">
            <label className="flex items-center gap-2 font-normal">
                <input
                    type="radio"
                    name={`boolean-${fieldKey}`}
                    checked={value === true}
                    onChange={() => onChange(true)}
                />
                Yes
            </label>
            <label className="flex items-center gap-2 font-normal">
                <input
                    type="radio"
                    name={`boolean-${fieldKey}`}
                    checked={value === false}
                    onChange={() => onChange(false)}
                />
                No
            </label>
        </div>
    </fieldset>
)

const ErrorList = ({ errors }) => {
    if (!errors.length) return null

    return (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="font-medium">Complete required fields before continuing.</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
                {errors.map((error) => (
                    <li key={error.message}>{error.message}</li>
                ))}
            </ul>
        </div>
    )
}

const ItemShell = ({ title, children, onRemove }) => (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
        <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">{title}</h4>
            <button
                type="button"
                onClick={onRemove}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            >
                Remove
            </button>
        </div>
        {children}
    </div>
)

const ItemSection = ({ title, items, addLabel, onAdd, children }) => (
    <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{title}</h3>
            <button
                type="button"
                onClick={onAdd}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            >
                {addLabel}
            </button>
        </div>
        {items.length > 0 ? (
            children
        ) : (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                No items added yet.
            </p>
        )}
    </div>
)

const RepeatField = ({
    step,
    model,
    options,
    definition,
    onChange,
    renderField,
}) => {
    const items = getValue(model, step.path, [])
    const itemTemplate = step.itemTemplate || {}

    const updateItem = (index, itemStep, itemValue) => {
        const nextItems = [...items]
        nextItems[index] = setValue(nextItems[index] || itemTemplate, itemStep.path, itemValue)
        onChange(nextItems)
    }

    const removeItem = (index) => {
        onChange(items.filter((_, itemIndex) => itemIndex !== index))
    }

    const addItem = () => {
        onChange([...items, clone(itemTemplate)])
    }

    return (
        <ItemSection
            title={step.title}
            items={items}
            addLabel={step.addLabel}
            onAdd={addItem}
        >
            {items.map((item, index) => {
                const labelPath = step.idStrategy?.sourcePath || "name"
                const title =
                    getValue(item, labelPath) || `${step.itemLabel || "Item"} ${index + 1}`

                return (
                    <ItemShell
                        key={`${step.path}-${index}`}
                        title={title}
                        onRemove={() => removeItem(index)}
                    >
                        {(step.itemSteps || []).map((itemStep) =>
                            renderField({
                                step: itemStep,
                                model,
                                value: getValue(item, itemStep.path),
                                onChange: (itemValue) =>
                                    updateItem(index, itemStep, itemValue),
                                options,
                                definition,
                                fieldKey: `${step.path}-${index}-${itemStep.id}`,
                            }),
                        )}
                    </ItemShell>
                )
            })}
        </ItemSection>
    )
}

const ReviewField = ({ model, definition, options }) => (
    <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Review JSON</h3>
        <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-muted p-3 text-[11px] leading-relaxed">
            {JSON.stringify(normalizeDraftForPreview(model, definition, options), null, 2)}
        </pre>
    </div>
)

const fieldRegistry = {
    text: TextField,
    textarea: TextAreaField,
    multiselect: MultiSelectField,
    boolean: BooleanField,
    repeat: RepeatField,
    review: ReviewField,
}

const fieldIsComplete = (step, value, model, options, definition) => {
    if (step.type === "boolean") return hasBoolean(value)
    if (step.type === "multiselect") {
        if (step.allowOther === false && step.optionsSource?.type === "modelCollection") {
            const validValues = new Set(
                resolveOptions(step, model, options, definition).map(
                    (option) => option.value,
                ),
            )
            return unique(value).some((item) => validValues.has(item))
        }
        return hasSelection(value)
    }
    return isPresent(value)
}

const requiredMessageFor = (step) =>
    step.requiredMessage || `${step.label || step.title || step.id} is required.`

const validateRepeatStep = (step, model, stageIndex, options, definition) => {
    const errors = []
    const items = getValue(model, step.path, [])

    if ((step.minItems || 0) > 0 && items.length < step.minItems) {
        errors.push({
            phase: stageIndex,
            message: step.minItemsMessage || `Add at least ${step.minItems} item.`,
        })
    }

    items.forEach((item, index) => {
        const labelPath = step.idStrategy?.sourcePath || "name"
        const itemLabel =
            getValue(item, labelPath) || `${step.itemLabel || "Item"} ${index + 1}`

        ;(step.itemSteps || []).forEach((itemStep) => {
            if (!itemStep.required) return

            const value = getValue(item, itemStep.path)
            if (!fieldIsComplete(itemStep, value, model, options, definition)) {
                errors.push({
                    phase: stageIndex,
                    message: `${itemLabel}: ${itemStep.label} is required.`,
                })
            }
        })
    })

    return errors
}

const validateStage = (definition, model, stageIndex, options) => {
    const stage = definition.stages[stageIndex]
    const errors = []

    ;(stage?.steps || []).forEach((step) => {
        if (step.type === "repeat") {
            errors.push(
                ...validateRepeatStep(step, model, stageIndex, options, definition),
            )
            return
        }

        if (step.type === "review" || !step.required) return

        const value = getValue(model, step.path)
        if (!fieldIsComplete(step, value, model, options, definition)) {
            errors.push({
                phase: stageIndex,
                message: requiredMessageFor(step),
            })
        }
    })

    return errors
}

const validateWizard = (definition, model, options, stageIndex = null) => {
    const stageIndexes =
        stageIndex === null
            ? (definition.stages || []).map((_, index) => index)
            : [stageIndex]

    return stageIndexes.flatMap((index) =>
        validateStage(definition, model, index, options),
    )
}

export default function QaWizard() {
    const definition = props.definition || {
        id: "architecture-qa",
        version: 1,
        title: "Architecture QA Wizard",
        modelTemplate: fallbackModel,
        stages: [],
    }
    const options = props.options || {}
    const stages = definition.stages || []
    const [phaseIndex, setPhaseIndex] = useState(0)
    const [validationErrors, setValidationErrors] = useState([])
    const [model, setModel] = useState(() =>
        hydrateModel(props.initialModel || definition.modelTemplate, definition),
    )

    const currentErrors = validationErrors.filter(
        (error) => error.phase === phaseIndex,
    )
    const progressWidth = useMemo(() => {
        if (!stages.length) return "0%"
        return `${((phaseIndex + 1) / stages.length) * 100}%`
    }, [phaseIndex, stages.length])

    const updatePath = (path, value) => {
        setValidationErrors([])
        setModel((current) => hydrateModel(setValue(current, path, value), definition))
    }

    const renderField = ({
        step,
        value = getValue(model, step.path),
        onChange = (fieldValue) => updatePath(step.path, fieldValue),
        model: rootModel = model,
        options: fieldOptions = options,
        definition: fieldDefinition = definition,
        fieldKey = step.id,
    }) => {
        const Component = fieldRegistry[step.type]
        if (!Component) return null

        return (
            <Component
                key={fieldKey}
                step={step}
                value={value}
                onChange={onChange}
                model={rootModel}
                options={fieldOptions}
                definition={fieldDefinition}
                fieldKey={fieldKey}
                renderField={renderField}
            />
        )
    }

    const goToPhase = (targetPhase) => {
        if (targetPhase > phaseIndex) {
            const errors = validateWizard(definition, model, options, phaseIndex)
            if (errors.length) {
                setValidationErrors(errors)
                return
            }
        }
        setValidationErrors([])
        setPhaseIndex(targetPhase)
    }

    const nextPhase = () => {
        const errors = validateWizard(definition, model, options, phaseIndex)
        if (errors.length) {
            setValidationErrors(errors)
            return
        }
        setValidationErrors([])
        setPhaseIndex(Math.min(stages.length - 1, phaseIndex + 1))
    }

    const submit = () => {
        const errors = validateWizard(definition, model, options)
        if (errors.length) {
            setValidationErrors(errors)
            setPhaseIndex(errors[0].phase)
            return
        }
        submitElement({ model })
    }

    const stage = stages[phaseIndex]

    return (
        <div className="flex flex-col gap-4 p-2">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1">
                    {stages.map((stageItem, index) => (
                        <button
                            type="button"
                            key={stageItem.id}
                            onClick={() => goToPhase(index)}
                            className={`rounded-md border px-2 py-1 text-xs ${
                                index === phaseIndex
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border hover:bg-muted"
                            }`}
                        >
                            {index + 1}. {stageItem.title}
                        </button>
                    ))}
                </div>
                <div className="h-1 rounded-full bg-muted">
                    <div
                        className="h-1 rounded-full bg-primary transition-all"
                        style={{ width: progressWidth }}
                    />
                </div>
            </div>

            <ErrorList errors={currentErrors} />

            <div className="flex flex-col gap-4">
                {(stage?.steps || []).map((step) =>
                    renderField({
                        step,
                        fieldKey: step.id,
                    }),
                )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                <button
                    type="button"
                    onClick={() => setPhaseIndex(Math.max(0, phaseIndex - 1))}
                    disabled={phaseIndex === 0}
                    className="rounded-md border border-border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 hover:bg-muted"
                >
                    Back
                </button>
                {phaseIndex < stages.length - 1 ? (
                    <button
                        type="button"
                        onClick={nextPhase}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                    >
                        Next
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={submit}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                    >
                        Submit JSON
                    </button>
                )}
            </div>
        </div>
    )
}
