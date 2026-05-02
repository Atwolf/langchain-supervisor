import { useMemo, useState } from "react"

const blankModel = {
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

const phases = [
    "System",
    "Access",
    "Components",
    "Data Stores",
    "Messaging",
    "External",
    "Review",
]

const clone = (value) => JSON.parse(JSON.stringify(value))

const unique = (values) => {
    const seen = new Set()
    return values.filter((value) => {
        const text = String(value || "").trim()
        if (!text || seen.has(text)) return false
        seen.add(text)
        return true
    })
}

const isPresent = (value) => String(value || "").trim().length > 0
const hasSelection = (values) => unique(values || []).length > 0
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

const normalizeNamedItems = (items, prefix, mapper) => {
    const seenIds = new Set()
    return (items || []).reduce((normalized, item, index) => {
        if (!String(item.name || "").trim()) {
            return normalized
        }

        const id = uniqueId(slugify(item.name, prefix), seenIds, index + 1)
        normalized.push(mapper(item, id))
        return normalized
    }, [])
}

const componentOptionsFor = (containers) => {
    const seenIds = new Set()
    return (containers || []).reduce((options, item, index) => {
        if (!isPresent(item.name)) {
            return options
        }

        const id = uniqueId(slugify(item.name, "container"), seenIds, index + 1)
        options.push({ value: id, label: item.name })
        return options
    }, [])
}

const normalizeModel = (model) => {
    const next = clone(model || blankModel)

    next.system = {
        ...blankModel.system,
        ...(next.system || {}),
        users: unique(next.system?.users || []),
        entry_points: unique(next.system?.entry_points || []),
        edge_layers: unique(next.system?.edge_layers || []),
    }

    next.containers = normalizeNamedItems(next.containers, "container", (item, id) => ({
        ...item,
        id,
        type: unique(item.type || []),
        framework: unique(item.framework || []),
        is_paa: Boolean(item.is_paa),
    }))

    const componentIds = new Set(next.containers.map((item) => item.id))
    const componentRefs = (values) =>
        unique(values || []).filter((value) => componentIds.has(value))

    next.data_stores = normalizeNamedItems(next.data_stores, "data_store", (item, id) => ({
        ...item,
        id,
        type: unique(item.type || []),
        read_components: componentRefs(item.read_components || []),
        write_components: componentRefs(item.write_components || []),
    }))

    next.messaging = normalizeNamedItems(next.messaging, "message", (item, id) => ({
        ...item,
        id,
        technology: unique(item.technology || []),
        publish_components: componentRefs(item.publish_components || []),
        consume_components: componentRefs(item.consume_components || []),
    }))

    next.external_systems = normalizeNamedItems(
        next.external_systems,
        "external",
        (item, id) => ({
            ...item,
            id,
            protocol: unique(item.protocol || []),
            connected_components: componentRefs(item.connected_components || []),
            integration_direction: unique(item.integration_direction || []),
        }),
    )

    return next
}

const hydrateModel = (model) => {
    const next = clone({ ...blankModel, ...(model || {}) })

    next.system = {
        ...blankModel.system,
        ...(next.system || {}),
        users: unique(next.system?.users || []),
        entry_points: unique(next.system?.entry_points || []),
        edge_layers: unique(next.system?.edge_layers || []),
    }

    next.containers = (next.containers || []).map((item) => ({
        ...emptyContainer(),
        ...item,
    }))
    next.data_stores = (next.data_stores || []).map((item) => ({
        ...emptyDataStore(),
        ...item,
    }))
    next.messaging = (next.messaging || []).map((item) => ({
        ...emptyMessage(),
        ...item,
    }))
    next.external_systems = (next.external_systems || []).map((item) => ({
        ...emptyExternalSystem(),
        ...item,
    }))

    return next
}

const emptyContainer = () => ({
    id: "",
    name: "",
    type: [],
    framework: [],
    description: "",
    is_paa: null,
})

const emptyDataStore = () => ({
    id: "",
    name: "",
    type: [],
    read_components: [],
    write_components: [],
})

const emptyMessage = () => ({
    id: "",
    name: "",
    technology: [],
    publish_components: [],
    consume_components: [],
})

const emptyExternalSystem = () => ({
    id: "",
    name: "",
    description: "",
    protocol: [],
    connected_components: [],
    integration_direction: [],
})

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

const TextInput = ({ value, onChange, placeholder = "", required = false }) => (
    <input
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        aria-required={required}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal outline-none focus:ring-1 focus:ring-primary"
    />
)

const TextArea = ({ value, onChange, placeholder = "", required = false }) => (
    <textarea
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        required={required}
        aria-required={required}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal outline-none focus:ring-1 focus:ring-primary"
    />
)

const MultiSelect = ({
    label,
    options,
    values,
    onChange,
    allowOther = true,
    required = false,
}) => {
    const [other, setOther] = useState("")
    const selected = values || []
    const labelFor = (value) => {
        const option = (options || []).find(
            (item) => (item.value || item) === value,
        )
        return option?.label || value
    }

    const toggle = (value) => {
        if (selected.includes(value)) {
            onChange(selected.filter((item) => item !== value))
        } else {
            onChange([...selected, value])
        }
    }

    const addOther = () => {
        const value = other.trim()
        if (!value) return
        onChange(unique([...selected, value]))
        setOther("")
    }

    return (
        <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                {label}
                {required && requiredBadge}
            </span>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {(options || []).map((option) => (
                    <label
                        key={option.value || option}
                        className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs font-normal"
                    >
                        <input
                            type="checkbox"
                            checked={selected.includes(option.value || option)}
                            onChange={() => toggle(option.value || option)}
                        />
                        <span>{option.label || option}</span>
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
                    {selected.map((value) => (
                        <button
                            type="button"
                            key={value}
                            onClick={() => toggle(value)}
                            className="rounded-full bg-muted px-2 py-0.5 text-xs"
                        >
                            {labelFor(value)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

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

const addItemErrors = ({
    errors,
    phase,
    items,
    sectionLabel,
    fields,
    componentIds = new Set(),
}) => {
    ;(items || []).forEach((item, index) => {
        const label = item.name || `${sectionLabel} ${index + 1}`
        fields.forEach((field) => {
            const value = item[field.key]
            let valid = false

            if (field.type === "list") {
                valid = hasSelection(value)
            } else if (field.type === "boolean") {
                valid = hasBoolean(value)
            } else if (field.type === "componentRefs") {
                valid = unique(value || []).some((itemValue) =>
                    componentIds.has(itemValue),
                )
            } else {
                valid = isPresent(value)
            }

            if (!valid) {
                errors.push({
                    phase,
                    message: `${label}: ${field.label} is required.`,
                })
            }
        })
    })
}

const validateWizard = (model, phase = null) => {
    const errors = []
    const shouldValidate = (phaseIndex) => phase === null || phase === phaseIndex
    const componentOptions = componentOptionsFor(model.containers)
    const componentIds = new Set(componentOptions.map((option) => option.value))

    if (shouldValidate(0)) {
        if (!isPresent(model.system?.name)) {
            errors.push({ phase: 0, message: "System name is required." })
        }
        if (!isPresent(model.system?.description)) {
            errors.push({ phase: 0, message: "System description is required." })
        }
        if (!hasSelection(model.system?.users)) {
            errors.push({ phase: 0, message: "Select at least one primary user." })
        }
    }

    if (shouldValidate(1)) {
        if (!hasSelection(model.system?.entry_points)) {
            errors.push({ phase: 1, message: "Select at least one access method." })
        }
        if (!hasSelection(model.system?.edge_layers)) {
            errors.push({ phase: 1, message: "Select at least one edge layer." })
        }
    }

    if (shouldValidate(2)) {
        if (!(model.containers || []).length) {
            errors.push({ phase: 2, message: "Add at least one application component." })
        }
        addItemErrors({
            errors,
            phase: 2,
            items: model.containers,
            sectionLabel: "Component",
            fields: [
                { key: "name", label: "Name" },
                { key: "type", label: "Type", type: "list" },
                { key: "framework", label: "Framework", type: "list" },
                { key: "description", label: "Description" },
                { key: "is_paa", label: "PAA?", type: "boolean" },
            ],
        })
    }

    if (shouldValidate(3)) {
        addItemErrors({
            errors,
            phase: 3,
            items: model.data_stores,
            sectionLabel: "Data store",
            componentIds,
            fields: [
                { key: "name", label: "Name" },
                { key: "type", label: "Type", type: "list" },
                { key: "read_components", label: "Read components", type: "componentRefs" },
                {
                    key: "write_components",
                    label: "Write components",
                    type: "componentRefs",
                },
            ],
        })
    }

    if (shouldValidate(4)) {
        addItemErrors({
            errors,
            phase: 4,
            items: model.messaging,
            sectionLabel: "Message channel",
            componentIds,
            fields: [
                { key: "name", label: "Name" },
                { key: "technology", label: "Technology", type: "list" },
                {
                    key: "publish_components",
                    label: "Publishing components",
                    type: "componentRefs",
                },
                {
                    key: "consume_components",
                    label: "Consuming components",
                    type: "componentRefs",
                },
            ],
        })
    }

    if (shouldValidate(5)) {
        addItemErrors({
            errors,
            phase: 5,
            items: model.external_systems,
            sectionLabel: "External system",
            componentIds,
            fields: [
                { key: "name", label: "Name" },
                { key: "description", label: "Description" },
                { key: "protocol", label: "Protocol", type: "list" },
                {
                    key: "connected_components",
                    label: "Connected components",
                    type: "componentRefs",
                },
                {
                    key: "integration_direction",
                    label: "Integration direction",
                    type: "list",
                },
            ],
        })
    }

    return errors
}

export default function QaWizard() {
    const options = props.options || {}
    const [phaseIndex, setPhaseIndex] = useState(0)
    const [validationErrors, setValidationErrors] = useState([])
    const [model, setModel] = useState(() =>
        hydrateModel({ ...blankModel, ...(props.initialModel || {}) }),
    )

    const componentOptions = useMemo(
        () => componentOptionsFor(model.containers),
        [model.containers],
    )
    const currentErrors = validationErrors.filter(
        (error) => error.phase === phaseIndex,
    )

    const updateSystem = (field, value) => {
        setValidationErrors([])
        setModel((current) => ({
            ...current,
            system: { ...current.system, [field]: value },
        }))
    }

    const updateList = (key, items) => {
        setValidationErrors([])
        setModel((current) => hydrateModel({ ...current, [key]: items }))
    }

    const updateItem = (key, index, patch) => {
        const items = [...(model[key] || [])]
        items[index] = { ...items[index], ...patch }
        updateList(key, items)
    }

    const removeItem = (key, index) => {
        updateList(
            key,
            (model[key] || []).filter((_, itemIndex) => itemIndex !== index),
        )
    }

    const addItem = (key, factory) => {
        updateList(key, [...(model[key] || []), factory()])
    }

    const goToPhase = (targetPhase) => {
        if (targetPhase > phaseIndex) {
            const errors = validateWizard(model, phaseIndex)
            if (errors.length) {
                setValidationErrors(errors)
                return
            }
        }
        setValidationErrors([])
        setPhaseIndex(targetPhase)
    }

    const nextPhase = () => {
        const errors = validateWizard(model, phaseIndex)
        if (errors.length) {
            setValidationErrors(errors)
            return
        }
        setValidationErrors([])
        setPhaseIndex(Math.min(phases.length - 1, phaseIndex + 1))
    }

    const submit = () => {
        const errors = validateWizard(model)
        if (errors.length) {
            setValidationErrors(errors)
            setPhaseIndex(errors[0].phase)
            return
        }
        const normalized = normalizeModel(model)
        submitElement({ model: normalized })
    }

    const renderPhase = () => {
        if (phaseIndex === 0) {
            return (
                <div className="flex flex-col gap-4">
                    <Field label="What is your system name?" required>
                        <TextInput
                            value={model.system.name}
                            onChange={(value) => updateSystem("name", value)}
                            placeholder="Payment Platform"
                            required
                        />
                    </Field>
                    <Field label="Describe your system in 1-2 sentences." required>
                        <TextArea
                            value={model.system.description}
                            onChange={(value) => updateSystem("description", value)}
                            placeholder="Summarize the purpose and operating context."
                            required
                        />
                    </Field>
                    <MultiSelect
                        label="Primary users"
                        options={options.user_types}
                        values={model.system.users}
                        onChange={(value) => updateSystem("users", value)}
                        required
                    />
                </div>
            )
        }

        if (phaseIndex === 1) {
            return (
                <div className="flex flex-col gap-4">
                    <MultiSelect
                        label="How do users or clients access the system?"
                        options={options.entry_points}
                        values={model.system.entry_points}
                        onChange={(value) => updateSystem("entry_points", value)}
                        required
                    />
                    <MultiSelect
                        label="Which edge layers sit in front of the system?"
                        options={options.edge_layers}
                        values={model.system.edge_layers}
                        onChange={(value) => updateSystem("edge_layers", value)}
                        required
                    />
                </div>
            )
        }

        if (phaseIndex === 2) {
            return (
                <ItemSection
                    title="Application Components"
                    items={model.containers}
                    onAdd={() => addItem("containers", emptyContainer)}
                    addLabel="Add component"
                >
                    {model.containers.map((item, index) => (
                        <ItemShell
                            key={`${item.id}-${index}`}
                            title={item.name || `Component ${index + 1}`}
                            onRemove={() => removeItem("containers", index)}
                        >
                            <Field label="Name" required>
                                <TextInput
                                    value={item.name}
                                    onChange={(value) =>
                                        updateItem("containers", index, { name: value })
                                    }
                                    required
                                />
                            </Field>
                            <MultiSelect
                                label="Type"
                                options={options.container_types}
                                values={item.type}
                                onChange={(value) =>
                                    updateItem("containers", index, { type: value })
                                }
                                required
                            />
                            <MultiSelect
                                label="Framework"
                                options={options.frameworks}
                                values={item.framework}
                                onChange={(value) =>
                                    updateItem("containers", index, {
                                        framework: value,
                                    })
                                }
                                required
                            />
                            <Field label="Description" required>
                                <TextArea
                                    value={item.description}
                                    onChange={(value) =>
                                        updateItem("containers", index, {
                                            description: value,
                                        })
                                    }
                                    required
                                />
                            </Field>
                            <fieldset className="flex flex-col gap-2 text-xs font-medium">
                                <legend className="flex items-center gap-2">
                                    PAA?
                                    {requiredBadge}
                                </legend>
                                <div className="flex gap-3">
                                    <label className="flex items-center gap-2 font-normal">
                                        <input
                                            type="radio"
                                            name={`paa-${index}`}
                                            checked={item.is_paa === true}
                                            onChange={() =>
                                                updateItem("containers", index, {
                                                    is_paa: true,
                                                })
                                            }
                                        />
                                        Yes
                                    </label>
                                    <label className="flex items-center gap-2 font-normal">
                                        <input
                                            type="radio"
                                            name={`paa-${index}`}
                                            checked={item.is_paa === false}
                                            onChange={() =>
                                                updateItem("containers", index, {
                                                    is_paa: false,
                                                })
                                            }
                                        />
                                        No
                                    </label>
                                </div>
                            </fieldset>
                        </ItemShell>
                    ))}
                </ItemSection>
            )
        }

        if (phaseIndex === 3) {
            return (
                <ItemSection
                    title="Data Stores"
                    items={model.data_stores}
                    onAdd={() => addItem("data_stores", emptyDataStore)}
                    addLabel="Add data store"
                >
                    {model.data_stores.map((item, index) => (
                        <ItemShell
                            key={`${item.id}-${index}`}
                            title={item.name || `Data store ${index + 1}`}
                            onRemove={() => removeItem("data_stores", index)}
                        >
                            <Field label="Name" required>
                                <TextInput
                                    value={item.name}
                                    onChange={(value) =>
                                        updateItem("data_stores", index, {
                                            name: value,
                                        })
                                    }
                                    required
                                />
                            </Field>
                            <MultiSelect
                                label="Type"
                                options={options.data_store_types}
                                values={item.type}
                                onChange={(value) =>
                                    updateItem("data_stores", index, { type: value })
                                }
                                required
                            />
                            <MultiSelect
                                label="Read components"
                                options={componentOptions}
                                values={item.read_components}
                                onChange={(value) =>
                                    updateItem("data_stores", index, {
                                        read_components: value,
                                    })
                                }
                                allowOther={false}
                                required
                            />
                            <MultiSelect
                                label="Write components"
                                options={componentOptions}
                                values={item.write_components}
                                onChange={(value) =>
                                    updateItem("data_stores", index, {
                                        write_components: value,
                                    })
                                }
                                allowOther={false}
                                required
                            />
                        </ItemShell>
                    ))}
                </ItemSection>
            )
        }

        if (phaseIndex === 4) {
            return (
                <ItemSection
                    title="Messaging"
                    items={model.messaging}
                    onAdd={() => addItem("messaging", emptyMessage)}
                    addLabel="Add message channel"
                >
                    {model.messaging.map((item, index) => (
                        <ItemShell
                            key={`${item.id}-${index}`}
                            title={item.name || `Message channel ${index + 1}`}
                            onRemove={() => removeItem("messaging", index)}
                        >
                            <Field label="Name" required>
                                <TextInput
                                    value={item.name}
                                    onChange={(value) =>
                                        updateItem("messaging", index, { name: value })
                                    }
                                    required
                                />
                            </Field>
                            <MultiSelect
                                label="Technology"
                                options={options.messaging_technologies}
                                values={item.technology}
                                onChange={(value) =>
                                    updateItem("messaging", index, {
                                        technology: value,
                                    })
                                }
                                required
                            />
                            <MultiSelect
                                label="Publishing components"
                                options={componentOptions}
                                values={item.publish_components}
                                onChange={(value) =>
                                    updateItem("messaging", index, {
                                        publish_components: value,
                                    })
                                }
                                allowOther={false}
                                required
                            />
                            <MultiSelect
                                label="Consuming components"
                                options={componentOptions}
                                values={item.consume_components}
                                onChange={(value) =>
                                    updateItem("messaging", index, {
                                        consume_components: value,
                                    })
                                }
                                allowOther={false}
                                required
                            />
                        </ItemShell>
                    ))}
                </ItemSection>
            )
        }

        if (phaseIndex === 5) {
            return (
                <ItemSection
                    title="External Systems"
                    items={model.external_systems}
                    onAdd={() => addItem("external_systems", emptyExternalSystem)}
                    addLabel="Add external system"
                >
                    {model.external_systems.map((item, index) => (
                        <ItemShell
                            key={`${item.id}-${index}`}
                            title={item.name || `External system ${index + 1}`}
                            onRemove={() => removeItem("external_systems", index)}
                        >
                            <Field label="Name" required>
                                <TextInput
                                    value={item.name}
                                    onChange={(value) =>
                                        updateItem("external_systems", index, {
                                            name: value,
                                        })
                                    }
                                    required
                                />
                            </Field>
                            <Field label="Description" required>
                                <TextArea
                                    value={item.description}
                                    onChange={(value) =>
                                        updateItem("external_systems", index, {
                                            description: value,
                                        })
                                    }
                                    required
                                />
                            </Field>
                            <MultiSelect
                                label="Protocol"
                                options={options.external_protocols}
                                values={item.protocol}
                                onChange={(value) =>
                                    updateItem("external_systems", index, {
                                        protocol: value,
                                    })
                                }
                                required
                            />
                            <MultiSelect
                                label="Connected components"
                                options={componentOptions}
                                values={item.connected_components}
                                onChange={(value) =>
                                    updateItem("external_systems", index, {
                                        connected_components: value,
                                    })
                                }
                                allowOther={false}
                                required
                            />
                            <MultiSelect
                                label="Integration direction"
                                options={options.integration_directions}
                                values={item.integration_direction}
                                onChange={(value) =>
                                    updateItem("external_systems", index, {
                                        integration_direction: value,
                                    })
                                }
                                required
                            />
                        </ItemShell>
                    ))}
                </ItemSection>
            )
        }

        return (
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Review JSON</h3>
                <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-muted p-3 text-[11px] leading-relaxed">
                    {JSON.stringify(normalizeModel(model), null, 2)}
                </pre>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4 p-2">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1">
                    {phases.map((phase, index) => (
                        <button
                            type="button"
                            key={phase}
                            onClick={() => goToPhase(index)}
                            className={`rounded-md border px-2 py-1 text-xs ${
                                index === phaseIndex
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border hover:bg-muted"
                            }`}
                        >
                            {index + 1}. {phase}
                        </button>
                    ))}
                </div>
                <div className="h-1 rounded-full bg-muted">
                    <div
                        className="h-1 rounded-full bg-primary"
                        style={{
                            width: `${((phaseIndex + 1) / phases.length) * 100}%`,
                        }}
                    />
                </div>
            </div>

            <ErrorList errors={currentErrors} />
            {renderPhase()}

            <div className="flex justify-between gap-2 border-t border-border pt-5">
                <button
                    type="button"
                    disabled={phaseIndex === 0}
                    onClick={() => goToPhase(Math.max(0, phaseIndex - 1))}
                    className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40"
                >
                    Back
                </button>
                {phaseIndex < phases.length - 1 ? (
                    <button
                        type="button"
                        onClick={nextPhase}
                        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                    >
                        Next
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={submit}
                        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                    >
                        Submit JSON
                    </button>
                )}
            </div>
        </div>
    )
}

const ItemSection = ({ title, items, onAdd, addLabel, children }) => (
    <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
            <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-xs text-muted-foreground">
                    Add one item per deployable or integration boundary.
                </p>
            </div>
            <button
                type="button"
                onClick={onAdd}
                className="rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground"
            >
                {addLabel}
            </button>
        </div>
        {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                No items added yet.
            </div>
        ) : (
            children
        )}
    </div>
)
