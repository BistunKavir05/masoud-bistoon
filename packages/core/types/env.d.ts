// هسته به محیط خاصی (Node یا مرورگر) وابسته نیست؛ فقط همین سطح کوچک از URL را لازم دارد که در هر دو موجود است.
declare class URL {
  constructor(input: string);
  readonly protocol: string;
  readonly href: string;
}
