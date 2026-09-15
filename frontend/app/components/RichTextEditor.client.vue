<script setup lang="ts">
import { Ckeditor } from '@ckeditor/ckeditor5-vue'
import {
  AutoLink,
  Autoformat,
  BlockQuote,
  Bold,
  ClassicEditor,
  Essentials,
  Heading,
  Italic,
  Link,
  List,
  Paragraph,
  Strikethrough,
  Underline,
} from 'ckeditor5'
import type { EditorConfig } from 'ckeditor5'
import 'ckeditor5/ckeditor5.css'

const props = withDefaults(defineProps<{
  modelValue: string
  disabled?: boolean
  placeholder?: string
}>(), {
  disabled: false,
  placeholder: 'Tulis deskripsi produk…',
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const runtimeConfig = useRuntimeConfig()
const editorConfig = computed<EditorConfig>(() => ({
  licenseKey: String(runtimeConfig.public.ckeditorLicenseKey || 'GPL'),
  plugins: [Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough, List, BlockQuote, Link, AutoLink, Autoformat],
  toolbar: {
    items: ['undo', 'redo', '|', 'heading', '|', 'bold', 'italic', 'underline', 'strikethrough', '|', 'bulletedList', 'numberedList', 'blockQuote', '|', 'link'],
    shouldNotGroupWhenFull: false,
  },
  heading: {
    options: [
      { model: 'paragraph', title: 'Paragraf', class: 'ck-heading_paragraph' },
      { model: 'heading2', view: 'h2', title: 'Judul bagian', class: 'ck-heading_heading2' },
      { model: 'heading3', view: 'h3', title: 'Subjudul', class: 'ck-heading_heading3' },
      { model: 'heading4', view: 'h4', title: 'Judul kecil', class: 'ck-heading_heading4' },
    ],
  },
  link: {
    defaultProtocol: 'https://',
  },
  placeholder: props.placeholder,
}))

function updateModelValue(value: unknown) {
  emit('update:modelValue', typeof value === 'string' ? value : '')
}
</script>

<template>
  <div class="rich-text-editor" :class="{ 'rich-text-editor--disabled': disabled }">
    <Ckeditor :editor="ClassicEditor" :model-value="modelValue" :config="editorConfig" :disabled="disabled" @update:model-value="updateModelValue" />
  </div>
</template>
