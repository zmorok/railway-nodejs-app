document.addEventListener('DOMContentLoaded', () => {
  const deleteButton = document.getElementById('deleteButton')
  const editableFields = document.querySelectorAll('.editable-field')

  if (!deleteButton || editableFields.length === 0) {
    return
  }

  editableFields.forEach((field) => {
    field.addEventListener('input', () => {
      deleteButton.disabled = true
    }, { once: true })
  })
})
