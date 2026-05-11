import { gzipSync } from 'zlib';

jest.mock('../../db/index.js', () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock('../../utils/s3Uploader.js', () => ({
  s3Uploader: jest.fn(),
}));

const writeTarField = (buffer, offset, length, value) => {
  buffer.write(value.slice(0, length), offset, length, 'utf8');
};

const createTarArchive = (entries) => {
  const blocks = [];

  entries.forEach(({ name, content }) => {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512, 0);
    const size = body.length.toString(8).padStart(11, '0');

    writeTarField(header, 0, 100, name);
    writeTarField(header, 100, 8, '0000644');
    writeTarField(header, 108, 8, '0000000');
    writeTarField(header, 116, 8, '0000000');
    writeTarField(header, 124, 12, `${size}\0`);
    writeTarField(header, 136, 12, `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0')}\0`);
    writeTarField(header, 156, 1, '0');
    writeTarField(header, 257, 6, 'ustar');
    writeTarField(header, 263, 2, '00');

    blocks.push(header);
    blocks.push(body);

    const remainder = body.length % 512;
    if (remainder > 0) {
      blocks.push(Buffer.alloc(512 - remainder, 0));
    }
  });

  blocks.push(Buffer.alloc(1024, 0));

  return Buffer.concat(blocks);
};

describe('pubMedResourceImageService', () => {
  it('extracts ordered figure references from article XML', async () => {
    const { extractFigureReferencesFromArticleXml } = await import(
      '../pubMedResourceImageService.js'
    );

    const articleXml = `
      <article xmlns:xlink="http://www.w3.org/1999/xlink">
        <body>
          <fig id="f1"><graphic xlink:href="fig1" /></fig>
          <fig id="f2"><graphic xlink:href="fig2.jpg" /></fig>
        </body>
      </article>
    `;

    expect(extractFigureReferencesFromArticleXml(articleXml)).toEqual([
      'fig1',
      'fig2.jpg',
    ]);
  });

  it('selects the first referenced figure from a PMC archive', async () => {
    const { extractFigureImageFromArchive } = await import(
      '../pubMedResourceImageService.js'
    );

    const articleXml = `
      <article xmlns:xlink="http://www.w3.org/1999/xlink">
        <body>
          <fig id="f1"><graphic xlink:href="fig1" /></fig>
        </body>
      </article>
    `;

    const tarBuffer = createTarArchive([
      {
        name: 'PMC123/article.nxml',
        content: articleXml,
      },
      {
        name: 'PMC123/logo.png',
        content: Buffer.from([9, 9, 9]),
      },
      {
        name: 'PMC123/fig1.jpg',
        content: Buffer.from([1, 2, 3, 4]),
      },
    ]);

    const result = extractFigureImageFromArchive(gzipSync(tarBuffer));

    expect(result).toBeTruthy();
    expect(result.figureReference).toBe('fig1');
    expect(result.entry.name).toBe('PMC123/fig1.jpg');
    expect(Buffer.from(result.entry.buffer)).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});
