# نتائج استكشاف Moodle Web Services API — سحب معايير BTEC ومعلومات الواجبات

توثيق لسلسلة فحوصات برمجية (أغسطس 2026) على تكامل Moodle Web Services، بهدف تحديد ما إذا كان يمكن سحب تعريفات معايير BTEC (P1-P6, M1-M3, D1-D3) ومعلومات الواجبات مباشرة من Moodle. السكريبتات المستخدمة: `backend/src/scripts/fetch-moodle-data.mjs`, `check-grading-functions.mjs`, `explore-zoho-service.mjs`, `fetch-rubric-definition.mjs`.

**القرار النهائي: التوقف عن متابعة مسار Moodle لسحب المعايير. لا يوجد مسار متاح حالياً، والدليل المعماري يشير إلى أن Moodle ليس مصدر الحقيقة لهذه المعايير أصلاً (انظر قسم ج).**

## أ) ما نجح فعلياً (متاح للاستخدام الآن)

| Function | التوكن | النتيجة |
|---|---|---|
| `core_webservice_get_site_info` | كلا التوكنين | ✅ يرجع اسم الموقع، إصدار Moodle، وقائمة كاملة بصلاحيات التوكن |
| `core_course_get_contents` | التوكن الأصلي | ✅ يرجع cmid/instance/contextid لأنشطة الواجب (assign) بأي مقرر |
| `mod_assign_get_assignments` | التوكن الأصلي | ✅ يرجع **العنوان، نص التعليمات (`intro`)، تواريخ الفتح/التسليم/الاستحقاق** لكل واجب — هذا مسار عملي متاح فوراً (انظر قسم د) |

## ب) ما فشل — بالأدلة التجريبية الحرفية

### `core_grading_get_definitions`
- **كلا التوكنين** (الأصلي و"Moodle-Zoho Integration Service") رجّعا نفس الخطأ الحرفي: `"Access control exception"` (errorcode: `accessexception`).
- تأكدنا بشكل قاطع، عبر مقارنة رسالة الخطأ مع استدعاء اسم function مختلَق تماماً (`this_function_does_not_exist_at_all`)، أن هذا التصنيف صحيح: **الدالة مسجّلة وموجودة فعلياً على تنصيب Moodle** (لأن رسالة "غير موجودة" الحقيقية مختلفة تماماً: `dml_missing_record_exception` / `"Can't find data record in database."`) — لكنها **غير مضافة لأي من الخدمات الثلاث الحالية** (External services) بحيث تشملها صلاحيات أي من التوكنين المتاحين حالياً.
- الحل النظري (إضافة الدالة من Site administration → Server → Web services → External services) يبقى ممكناً تقنياً، لكن — انظر قسم ج — تبيّن أنه غير مجدٍ عملياً.

### `local_mzi_*` (البلجن المحلي المرتبط بخدمة "Moodle-Zoho Integration Service")
- القائمة الكاملة لهذا البلجن (4 functions فقط): `local_mzi_get_moodle_ids`, `local_mzi_submit_grade`, `local_mzi_delete_grade`, `local_mzi_enrol_users`.
- **لا توجد أي دالة قراءة (`get`/`list`) لتعريفات المعايير بهذا البلجن.** تأكدنا من هذا بتجربة 4 أسماء محتملة لدوال قراءة غير موثّقة:
  - `local_mzi_get_btec_definition`
  - `local_mzi_get_btec_definitions`
  - `local_mzi_list_btec_definitions`
  - `local_moodle_zoho_sync_get_btec_definition`
  - **كل الأربعة رجّعت بالضبط نفس رسالة "غير موجودة أصلاً"**: `dml_missing_record_exception` / errorcode `invalidrecordunknown` / `"Can't find data record in database."` — مطابقة تماماً لرسالة اسم function مختلَق، أي أنها غير مسجّلة على الإطلاق، وليست فقط "ممنوعة".

### `gradingform_rubric_grader_gradingpanel_fetch`
- دالة Moodle-core قياسية (وليست جزءاً من `local_mzi`)، **متاحة ومسموحة فعلياً** لتوكن "Zoho" (غير متاحة للتوكن الأصلي) — تأكدنا من هذا لأن استدعاءها بدون معاملات رجّع `invalid_parameter_exception` (errorcode: `invalidparameter`) وليس `accessexception`.
- جُرِّبت **20 تركيبة معاملات مختلفة** (5 أشكال معاملات محتملة × واجبا المقرر التجريبي 513 × معرّفَي طالب وهميين `999999999` و`0`، **بدون أي معرّف طالب حقيقي**) — **كل المحاولات رجّعت نفس رسالة الخطأ العامة**: `"Invalid parameter value detected"`.
- السبب: **debug mode مطفي على مستوى الموقع**، فرسائل الخطأ التفصيلية (اللي عادة بتكشف اسم المعامل الناقص/الخاطئ بالضبط) مخفية عن العميل. لا يوجد طريق برمجي بديل لاكتشاف شكل المعاملات الدقيق بدون الوصول لكود الـplugin على السيرفر أو تفعيل debug مؤقتاً — وكلاهما لم يُنفَّذ.
- **لم يتم لمس أي بيانات طالب حقيقية** في هذا الاستكشاف: كل الاستدعاءات استخدمت فقط معرّفات طالب وهمية مستحيلة، ولم يُستدعَ أي function يسرد طلاباً حقيقيين للحصول على معرّف صالح.
- **لم تتم متابعة هذا المسار على مقرر حقيقي** — تقرر التوقف نهائياً (انظر قسم ج) بدلاً من الانتقال من المقرر التجريبي.

## ج) الاستنتاج المعماري: Moodle ليس مصدر الحقيقة (system of record) لمعايير BTEC

الدليل الأقوى على هذا هو **تركيبة الصلاحيات الممنوحة لتوكن "Moodle-Zoho Integration Service" نفسه**: هذا التوكن مصمَّم خصيصاً حول بلجن `local_mzi` الذي يحتوي فقط على:
- `local_mzi_submit_grade` / `local_mzi_delete_grade` (كتابة درجات)
- `local_mzi_enrol_users` (كتابة تسجيل)
- `local_mzi_get_moodle_ids` (القراءة الوحيدة، ولوظيفة مساعدة فقط — الأرجح تحويل معرّفات، وليس قراءة معايير)
- **بدون أي `local_mzi_get_btec_definition` أو ما يعادلها**

لو كان Moodle هو مصدر الحقيقة لمعايير BTEC، لكان منطقياً أن يحتوي بلجن التكامل المخصص هذا (المصمَّم خصيصاً للتواصل بين Moodle وZoho) على دالة لقراءة/تصدير هذه المعايير من Moodle إلى Zoho. غيابها التام — مع وجود `create`/`delete` فقط لتعريفات BTEC (`local_moodle_zoho_sync_create_btec_definition`, وبالافتراض `local_mzi` المكافئ) — **يوحي بقوة أن التدفق يسير بالاتجاه المعاكس: Zoho هو من يملك تعريفات BTEC، وMoodle يستقبلها/يزامنها منه، لا العكس.**

**التوصية:** أي محاولة مستقبلية لسحب معايير BTEC برمجياً يجب أن تستهدف **Zoho API مباشرة**، وليس Moodle. متابعة مسار Moodle (حتى عبر حلول مثل تفعيل debug mode أو طلب صلاحيات إضافية) غير مجدية معمارياً بغض النظر عن أي عائق تقني مؤقت، لأن المعايير على الأرجح غير موجودة أصلاً كبيانات كاملة داخل Moodle نفسه.

## د) المسار العملي المتاح فوراً — فجوة قائمة بالكود يستحق سدّها

`mod_assign_get_assignments` (موثّق بقسم أ كنجاح مؤكد) يوفر **بالفعل** ما يلزم لسدّ فجوة موجودة حالياً بالكود: في `backend/src/routes/review.js`، الاستدعاء الفعلي لـ`reviewAssignment` يمرّر:
```js
aiResult = await reviewAssignment({
  studentText: studentResult.text,
  briefText: '',      // ← فارغ دائماً حالياً
  rubricText: '',      // ← فارغ دائماً حالياً
})
```
`briefText` (نص تعليمات الواجب) يمكن سدّه فعلياً الآن عبر حقل `intro` من `mod_assign_get_assignments` — بدون أي حاجة لحل مشكلة المعايير المذكورة أعلاه. هذا تحسين منفصل وقابل للتنفيذ بمعزل عن قرار التوقف عن مسار المعايير.

**لم يُنفَّذ أي تعديل على الكود ضمن هذا التوثيق — هذا القسم توثيق لفرصة قائمة فقط، بانتظار قرار منفصل بالتنفيذ.**

## السكريبتات المرجعية

- `backend/src/scripts/fetch-moodle-data.mjs` — السحب الأساسي (4 استدعاءات بالترتيب المطلوب أصلاً)
- `backend/src/scripts/check-grading-functions.mjs` — بحث بالكلمات المفتاحية + تصنيف أخطاء 3 functions مرشّحة
- `backend/src/scripts/explore-zoho-service.mjs` — مقارنة التوكنين + استكشاف بلجن `local_mzi`
- `backend/src/scripts/fetch-rubric-definition.mjs` — محاولة `gradingform_rubric_grader_gradingpanel_fetch` (فشلت، موثّقة بقسم ب)
- `backend/eval-data/moodle-api-dump.json` — نتائج خام من `fetch-moodle-data.mjs` (لا بيانات طلاب)
