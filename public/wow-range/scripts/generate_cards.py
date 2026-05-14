import csv
import os

template_path = 'public/wow-range/cards/wow_range_template_master.html'
csv_path = 'public/wow-range/data/wow_range_qr_matrix.csv'
output_dir = 'public/wow-range/cards/'

# Assicuriamoci che la cartella esista
os.makedirs(output_dir, exist_ok=True)

with open(template_path, 'r', encoding='utf-8') as f:
    template = f.read()

with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        card_content = template
        for key, value in row.items():
            card_content = card_content.replace(f'{{{{{key}}}}}', value)
        
        filename = f"card-{row['sku']}.html"
        with open(os.path.join(output_dir, filename), 'w', encoding='utf-8') as out:
            out.write(card_content)
        print(f"Generated {filename}")
